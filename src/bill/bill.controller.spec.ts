import { BadRequestException, INestApplication, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as request from 'supertest';
import { BillController } from './bill.controller';
import { BillService } from './bill.service';

// sharp's native binary is not needed to construct the controller (and may be
// missing on dev machines), so replace it.
jest.mock('sharp', () => jest.fn());

describe('BillController', () => {
  let controller: BillController;
  const service = {
    getOwnedBill: jest.fn(),
    removeOwned: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillController],
      providers: [{ provide: BillService, useValue: service }],
    }).compile();

    controller = module.get<BillController>(BillController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('getBillDetails passes the request user id', async () => {
    service.getOwnedBill.mockResolvedValue({ id: 5 });
    await expect(controller.getBillDetails(5, { user: { id: 7 } })).resolves.toEqual({ id: 5 });
    expect(service.getOwnedBill).toHaveBeenCalledWith(5, 7);
  });

  it('getBillDetails returns 404 when there is no request user', async () => {
    await expect(controller.getBillDetails(5, { user: null })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(service.getOwnedBill).not.toHaveBeenCalled();
  });

  it('remove passes the request user id and returns the delete result', async () => {
    service.removeOwned.mockResolvedValue({ affected: 1 });
    await expect(controller.remove(5, { user: { id: 7 } })).resolves.toEqual({ affected: 1 });
    expect(service.removeOwned).toHaveBeenCalledWith(5, 7);
  });

  it('remove returns 404 when there is no request user', async () => {
    await expect(controller.remove(5, { user: undefined })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(service.removeOwned).not.toHaveBeenCalled();
  });
});

describe('BillController (HTTP)', () => {
  let app: INestApplication;
  let uploads: string;
  let user: any;
  const service = {
    updateWithPhotos: jest.fn(),
    create: jest.fn(),
    addPhoto: jest.fn(),
    getBillById: jest.fn(),
    assertTargetAccount: jest.fn(),
  };
  const V4_JPG = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/;
  const uploaded = () => fs.readdirSync(uploads);

  beforeEach(async () => {
    jest.resetAllMocks();
    uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'bill-uploads-'));
    process.env.UPLOADS_DIR = uploads;
    user = { id: 7 };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillController],
      providers: [{ provide: BillService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    // Stand-in for the auth middleware.
    app.use((req: any, _res: any, next: () => void) => {
      req.user = user;
      next();
    });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.UPLOADS_DIR;
    fs.rmSync(uploads, { recursive: true, force: true });
  });

  describe('PATCH /bill/:id', () => {
    it('parses the multipart body and passes the dto and files to the service', async () => {
      service.updateWithPhotos.mockResolvedValue({ id: 5, photos: [] });
      const res = await request(app.getHttpServer())
        .patch('/bill/5')
        .field('body', JSON.stringify({ comment: 'hi', removePhotoIds: [3, '4'] }))
        .attach('files', Buffer.from('one'), 'a.jpg')
        .attach('files', Buffer.from('two'), 'B.PNG');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: 5, photos: [] });
      expect(service.updateWithPhotos).toHaveBeenCalledTimes(1);
      const [id, userId, dto, files] = service.updateWithPhotos.mock.calls[0];
      expect(id).toBe(5);
      expect(userId).toBe(7);
      expect(dto.comment).toBe('hi');
      expect(dto.removePhotoIds).toEqual([3, 4]);
      expect(files).toHaveLength(2);
      expect(files.map((f: any) => f.originalname)).toEqual(['a.jpg', 'B.PNG']);
      expect(uploaded().sort()).toEqual(files.map((f: any) => f.filename).sort());
    });

    it('accepts a plain JSON body without files', async () => {
      service.updateWithPhotos.mockResolvedValue({ id: 5 });
      const res = await request(app.getHttpServer())
        .patch('/bill/5')
        .send({ comment: 'json', removePhotoIds: [1], user: { id: 99 } });
      expect(res.status).toBe(200);
      const [id, userId, dto, files] = service.updateWithPhotos.mock.calls[0];
      expect([id, userId]).toEqual([5, 7]);
      expect(dto.comment).toBe('json');
      expect(dto.removePhotoIds).toEqual([1]);
      expect(dto.user).toBeUndefined();
      expect(files).toEqual([]);
    });

    it('rejects a .PDF upload with 400 and keeps no file', async () => {
      const res = await request(app.getHttpServer())
        .patch('/bill/5')
        .field('body', '{}')
        .attach('files', Buffer.from('ok'), 'a.jpg')
        .attach('files', Buffer.from('%PDF'), 'doc.PDF');
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Photos must be JPG, PNG, GIF or WebP.');
      expect(service.updateWithPhotos).not.toHaveBeenCalled();
      expect(uploaded()).toEqual([]);
    });

    it('rejects an 11 MB file with 413 and keeps no file', async () => {
      const res = await request(app.getHttpServer())
        .patch('/bill/5')
        .field('body', '{}')
        .attach('files', Buffer.alloc(11 * 1024 * 1024), 'big.jpg');
      expect(res.status).toBe(413);
      expect(service.updateWithPhotos).not.toHaveBeenCalled();
      expect(uploaded()).toEqual([]);
    });

    it('returns 404 without a request user and deletes the uploads', async () => {
      user = null;
      const res = await request(app.getHttpServer())
        .patch('/bill/5')
        .field('body', '{}')
        .attach('files', Buffer.from('one'), 'a.jpg');
      expect(res.status).toBe(404);
      expect(service.updateWithPhotos).not.toHaveBeenCalled();
      expect(uploaded()).toEqual([]);
    });

    it('rejects an invalid body with 400 and deletes the uploads', async () => {
      for (const body of ['{not json', JSON.stringify({ removePhotoIds: ['x'] })]) {
        const res = await request(app.getHttpServer())
          .patch('/bill/5')
          .field('body', body)
          .attach('files', Buffer.from('one'), 'a.jpg');
        expect(res.status).toBe(400);
      }
      expect(service.updateWithPhotos).not.toHaveBeenCalled();
      expect(uploaded()).toEqual([]);
    });

    it('rejects a non-numeric id with 400 and deletes the uploads', async () => {
      const res = await request(app.getHttpServer())
        .patch('/bill/abc')
        .field('body', '{}')
        .attach('files', Buffer.from('one'), 'a.jpg');
      expect(res.status).toBe(400);
      expect(service.updateWithPhotos).not.toHaveBeenCalled();
      expect(uploaded()).toEqual([]);
    });
  });

  describe('POST /bill', () => {
    it('skips a disallowed file instead of rejecting, as before', async () => {
      service.create.mockResolvedValue({ id: 11 });
      service.addPhoto.mockResolvedValue({});
      service.getBillById.mockResolvedValue({ id: 11 });
      const res = await request(app.getHttpServer())
        .post('/bill')
        .field('body', JSON.stringify({ price: 1 }))
        .attach('files', Buffer.from('%PDF'), 'doc.PDF')
        .attach('files', Buffer.from('img'), 'IMG_1.JPG');
      expect(res.status).toBe(201);
      expect(service.create).toHaveBeenCalledTimes(1);
      expect(service.addPhoto).toHaveBeenCalledTimes(1);
      const photo = service.addPhoto.mock.calls[0][0];
      expect(photo.name).toBe('IMG_1.JPG');
      expect(photo.path).toMatch(V4_JPG);
      expect(uploaded()).toEqual([photo.path]);
    });

    it('accepts an 11 MB file, as POST allows up to 50 MB', async () => {
      service.create.mockResolvedValue({ id: 12 });
      service.addPhoto.mockResolvedValue({});
      service.getBillById.mockResolvedValue({ id: 12 });
      const res = await request(app.getHttpServer())
        .post('/bill')
        .field('body', JSON.stringify({ price: 1 }))
        .attach('files', Buffer.alloc(11 * 1024 * 1024), 'big.jpg');
      expect(res.status).toBe(201);
      expect(service.create).toHaveBeenCalledTimes(1);
      expect(service.addPhoto).toHaveBeenCalledTimes(1);
    });

    it('rejects a file over 50 MB with 413 and keeps no file', async () => {
      const res = await request(app.getHttpServer())
        .post('/bill')
        .field('body', '{}')
        .attach('files', Buffer.alloc(51 * 1024 * 1024), 'huge.jpg');
      expect(res.status).toBe(413);
      expect(service.create).not.toHaveBeenCalled();
      expect(uploaded()).toEqual([]);
    });

    it('still accepts the mobile request shape, including upper-case extensions', async () => {
      service.create.mockResolvedValue({ id: 10 });
      service.addPhoto.mockResolvedValue({});
      service.getBillById.mockResolvedValue({ id: 10, photos: [{ id: 1 }] });
      const bill = {
        date: '2026-10-01T00:00:00.000Z',
        price: 3.5,
        shop: { id: 1 },
        category: { id: 2 },
      };
      const res = await request(app.getHttpServer())
        .post('/bill')
        .field('body', JSON.stringify(bill))
        .attach('files', Buffer.from('img'), 'IMG_1.JPG');
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: 10, photos: [{ id: 1 }] });
      expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ ...bill, user }));
      expect(service.addPhoto).toHaveBeenCalledTimes(1);
      const photo = service.addPhoto.mock.calls[0][0];
      expect(photo.name).toBe('IMG_1.JPG');
      expect(photo.path).toMatch(V4_JPG);
      expect(photo.blurhash).toBe('000000');
      expect(photo.bill).toEqual({ id: 10 });
      expect(uploaded()).toEqual([photo.path]);
      expect(service.getBillById).toHaveBeenCalledWith(10);
    });

    it('checks the target account before creating, then lets a member through', async () => {
      service.create.mockResolvedValue({ id: 13 });
      service.getBillById.mockResolvedValue({ id: 13 });
      const res = await request(app.getHttpServer())
        .post('/bill')
        .field('body', JSON.stringify({ price: 1, account: { id: 4 } }));
      expect(res.status).toBe(201);
      expect(service.assertTargetAccount).toHaveBeenCalledWith({ id: 4 }, 7);
      expect(service.create).toHaveBeenCalledTimes(1);
    });

    it('gives 404 for a non-member target account, writes nothing and removes the uploads', async () => {
      service.assertTargetAccount.mockRejectedValue(new NotFoundException());
      const res = await request(app.getHttpServer())
        .post('/bill')
        .field('body', JSON.stringify({ price: 1, account: { id: 4 } }))
        .attach('files', Buffer.from('img'), 'IMG_1.JPG');
      expect(res.status).toBe(404);
      expect(service.create).not.toHaveBeenCalled();
      expect(service.addPhoto).not.toHaveBeenCalled();
      expect(uploaded()).toEqual([]);
    });

    it('removes the uploads when the account check gives 400', async () => {
      service.assertTargetAccount.mockRejectedValue(new BadRequestException('Invalid account.'));
      const res = await request(app.getHttpServer())
        .post('/bill')
        .field('body', JSON.stringify({ price: 1, account: 77 }))
        .attach('files', Buffer.from('img'), 'IMG_1.JPG');
      expect(res.status).toBe(400);
      expect(service.create).not.toHaveBeenCalled();
      expect(uploaded()).toEqual([]);
    });

    it('gives 404 without a request user and removes the uploads', async () => {
      user = undefined;
      const res = await request(app.getHttpServer())
        .post('/bill')
        .field('body', JSON.stringify({ price: 1 }))
        .attach('files', Buffer.from('img'), 'IMG_1.JPG');
      expect(res.status).toBe(404);
      expect(service.create).not.toHaveBeenCalled();
      expect(uploaded()).toEqual([]);
    });

    it('gives 400 Invalid body. for malformed JSON and removes the uploads', async () => {
      const res = await request(app.getHttpServer())
        .post('/bill')
        .field('body', '{not json')
        .attach('files', Buffer.from('img'), 'IMG_1.JPG');
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid body.');
      expect(service.create).not.toHaveBeenCalled();
      expect(uploaded()).toEqual([]);
    });

    it('removes the uploads when create fails', async () => {
      service.create.mockRejectedValue(new Error('db down'));
      const res = await request(app.getHttpServer())
        .post('/bill')
        .field('body', JSON.stringify({ price: 1 }))
        .attach('files', Buffer.from('img'), 'IMG_1.JPG');
      expect(res.status).toBe(500);
      expect(uploaded()).toEqual([]);
    });

    it('removes the uploads when saving a photo fails', async () => {
      service.create.mockResolvedValue({ id: 14 });
      service.addPhoto.mockRejectedValue(new Error('db down'));
      const res = await request(app.getHttpServer())
        .post('/bill')
        .field('body', JSON.stringify({ price: 1 }))
        .attach('files', Buffer.from('img'), 'IMG_1.JPG');
      expect(res.status).toBe(500);
      expect(uploaded()).toEqual([]);
    });
  });
});
