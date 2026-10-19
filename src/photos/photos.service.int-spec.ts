import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import {
  createIntegrationModule,
  truncateTables,
  waitForLockWait,
} from '../../test/db.js';
import { jpeg } from '../../test/images.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { BillsService } from '../bills/bills.service.js';
import { CategoriesModule } from '../categories/categories.module.js';
import { ShopsModule } from '../shops/shops.module.js';
import { UsersService } from '../users/users.service.js';
import { BillPhoto } from './bill-photo.entity.js';
import { PhotoStorage } from './photo-storage.js';
import { PhotosModule } from './photos.module.js';
import { type PhotoUpload, PhotosService } from './photos.service.js';

const uploadsDir = () => process.env.UPLOADS_DIR!;
const storedFiles = async () =>
  (await readdir(uploadsDir())).filter((name) => name.endsWith('.jpg'));

describe('PhotosService (integration)', () => {
  let moduleRef: TestingModule;
  let photos: PhotosService;
  let bills: BillsService;
  let accounts: AccountsService;
  let users: UsersService;
  let storage: PhotoStorage;
  let dataSource: DataSource;

  const createUser = (email = 'ana@example.com', displayName = 'Ana') =>
    users.create({ email, displayName, passwordHash: 'hash' });
  const photoCount = () => dataSource.getRepository(BillPhoto).count();
  /** Writes an upload where multer would have put it. */
  const upload = async (
    data: Buffer | Promise<Buffer>,
    originalName = 'receipt.jpg',
  ): Promise<PhotoUpload> => {
    const path = join(storage.incomingDir, randomUUID());
    await writeFile(path, await data);
    return { path, originalName };
  };
  const setup = async () => {
    const ana = await createUser();
    const home = await accounts.create(ana.id, 'Home');
    const bill = await bills.create(ana.id, {
      accountId: home.id,
      date: new Date('2026-10-16T11:26:00.000Z'),
      priceCents: 100,
    });
    return { ana, home, bill };
  };

  beforeAll(async () => {
    moduleRef = await createIntegrationModule({
      imports: [PhotosModule, ShopsModule, CategoriesModule],
    });
    await moduleRef.init();
    photos = moduleRef.get(PhotosService);
    bills = moduleRef.get(BillsService);
    accounts = moduleRef.get(AccountsService);
    users = moduleRef.get(UsersService);
    storage = moduleRef.get(PhotoStorage);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(() => moduleRef.close());

  beforeEach(async () => {
    await truncateTables(dataSource);
    // The uploads directory lives as long as the file, not the test.
    for (const name of await storedFiles()) {
      await rm(join(uploadsDir(), name));
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores re-encoded photos with displayed sizes, cleaned names and the uploader', async () => {
    const { ana, bill } = await setup();

    const added = await photos.add(ana.id, bill.id, [
      await upload(
        jpeg(4000, 3000, { orientation: 6 }),
        'C:\\phone\\IMG_1.jpg',
      ),
      await upload(jpeg(640, 480), 'second.jpg'),
    ]);

    expect(added.map((p) => [p.name, p.width, p.height])).toEqual([
      ['IMG_1.jpg', 1920, 2560],
      ['second.jpg', 640, 480],
    ]);
    expect(added[0].createdById).toBe(ana.id);
    expect((await storedFiles()).sort()).toEqual(
      added.map((p) => `${p.id}.jpg`).sort(),
    );
    const { photo, file } = await photos.open(ana.id, bill.id, added[0].id);
    expect(file.size).toBe(photo.sizeBytes);
    file.stream.destroy();
  });

  it('answers 400 for something that is not an image, and stores nothing', async () => {
    const { ana, bill } = await setup();

    await expect(
      photos.add(ana.id, bill.id, [
        await upload(jpeg()),
        await upload(Buffer.from('not an image'), 'fake.jpg'),
      ]),
    ).rejects.toThrow(new BadRequestException('Unsupported image'));
    expect(await photoCount()).toBe(0);
    expect(await storedFiles()).toEqual([]);
  });

  it('answers 404 to a non-member, and stores nothing', async () => {
    const { bill } = await setup();
    const bob = await createUser('bob@example.com', 'Bob');

    await expect(
      photos.add(bob.id, bill.id, [await upload(jpeg())]),
    ).rejects.toThrow(new NotFoundException('Bill not found'));
    expect(await photoCount()).toBe(0);
    expect(await storedFiles()).toEqual([]);
  });

  it('answers 409 past 10 photos per bill', async () => {
    const { ana, bill } = await setup();
    const eight = await Promise.all(
      Array.from({ length: 8 }, () => upload(jpeg())),
    );
    await photos.add(ana.id, bill.id, eight);

    await expect(
      photos.add(ana.id, bill.id, [
        await upload(jpeg()),
        await upload(jpeg()),
        await upload(jpeg()),
      ]),
    ).rejects.toThrow(
      new ConflictException('A bill can have at most 10 photos'),
    );
    expect(await photoCount()).toBe(8);
  });

  it('counts photos committed by a concurrent upload: never more than 10', async () => {
    const { ana, bill } = await setup();
    // A concurrent upload holds the bill lock with 5 uncommitted photos.
    const other = dataSource.createQueryRunner();
    await other.connect();
    await other.startTransaction();
    let committed = false;
    try {
      await other.query(
        'SELECT id FROM bills WHERE id = $1 FOR NO KEY UPDATE',
        [bill.id],
      );
      for (let i = 0; i < 5; i++) {
        await other.manager.getRepository(BillPhoto).insert({
          billId: bill.id,
          name: 'other.jpg',
          width: 1,
          height: 1,
          sizeBytes: 1,
        });
      }
      const six = await Promise.all(
        Array.from({ length: 6 }, () => upload(jpeg())),
      );
      const adding = photos.add(ana.id, bill.id, six).then(
        () => 'added',
        (error: unknown) => error,
      );

      await waitForLockWait(dataSource);
      await other.commitTransaction();
      committed = true;

      expect(await adding).toEqual(
        new ConflictException('A bill can have at most 10 photos'),
      );
      expect(await photoCount()).toBe(5);
    } finally {
      if (!committed) {
        await other.rollbackTransaction();
      }
      await other.release();
    }
  });

  it('leaves no row and no file when writing a file fails', async () => {
    const { ana, bill } = await setup();
    const write = vi.spyOn(storage, 'write');
    write.mockImplementationOnce((id, data) =>
      PhotoStorage.prototype.write.call(storage, id, data),
    );
    write.mockRejectedValueOnce(new Error('disk full'));

    await expect(
      photos.add(ana.id, bill.id, [await upload(jpeg()), await upload(jpeg())]),
    ).rejects.toThrow('disk full');
    expect(await photoCount()).toBe(0);
    expect(await storedFiles()).toEqual([]);
  });

  it('removes a photo and its file; a photo of another bill answers 404', async () => {
    const { ana, home, bill } = await setup();
    const other = await bills.create(ana.id, {
      accountId: home.id,
      date: new Date('2026-10-16T11:26:00.000Z'),
      priceCents: 200,
    });
    const [photo] = await photos.add(ana.id, bill.id, [await upload(jpeg())]);

    await expect(photos.remove(ana.id, other.id, photo.id)).rejects.toThrow(
      new NotFoundException('Photo not found'),
    );
    await photos.remove(ana.id, bill.id, photo.id);

    expect(await photoCount()).toBe(0);
    expect(await storedFiles()).toEqual([]);
  });

  it('removes the file when the photo id arrives in upper case', async () => {
    const { ana, bill } = await setup();
    const [photo] = await photos.add(ana.id, bill.id, [await upload(jpeg())]);

    await photos.remove(ana.id, bill.id, photo.id.toUpperCase());

    expect(await photoCount()).toBe(0);
    expect(await storedFiles()).toEqual([]);
  });

  it('opens a photo by an upper case id, but not through another bill', async () => {
    const { ana, home, bill } = await setup();
    const other = await bills.create(ana.id, {
      accountId: home.id,
      date: new Date('2026-10-16T11:26:00.000Z'),
      priceCents: 200,
    });
    const [photo] = await photos.add(ana.id, bill.id, [await upload(jpeg())]);

    const opened = await photos.open(ana.id, bill.id, photo.id.toUpperCase());
    expect(opened.photo.id).toBe(photo.id);
    opened.file.stream.destroy();
    await expect(photos.open(ana.id, other.id, photo.id)).rejects.toThrow(
      new NotFoundException('Photo not found'),
    );
  });

  it('answers 404 when the file is missing', async () => {
    const { ana, bill } = await setup();
    const [photo] = await photos.add(ana.id, bill.id, [await upload(jpeg())]);
    await storage.delete(photo.id);

    await expect(photos.open(ana.id, bill.id, photo.id)).rejects.toThrow(
      new NotFoundException('Photo not found'),
    );
  });

  describe('with bills', () => {
    it('lists bills with their photos, still paging by bills', async () => {
      const { ana, home, bill } = await setup();
      const second = await bills.create(ana.id, {
        accountId: home.id,
        date: new Date('2026-10-15T11:26:00.000Z'),
        priceCents: 200,
      });
      await photos.add(ana.id, bill.id, [
        await upload(jpeg(), 'a.jpg'),
        await upload(jpeg(), 'b.jpg'),
        await upload(jpeg(), 'c.jpg'),
      ]);

      const first = await bills.list(ana.id, { limit: 1 });
      const next = await bills.list(ana.id, {
        limit: 1,
        cursor: first.nextCursor ?? undefined,
      });

      expect(first.items).toHaveLength(1);
      expect(first.items[0].photos?.map((p) => p.name)).toEqual([
        'a.jpg',
        'b.jpg',
        'c.jpg',
      ]);
      expect(next.items.map((b) => [b.id, b.photos])).toEqual([
        [second.id, []],
      ]);
      await expect(bills.findForMember(bill.id, ana.id)).resolves.toMatchObject(
        {
          photos: [{ name: 'a.jpg' }, { name: 'b.jpg' }, { name: 'c.jpg' }],
        },
      );
    });

    it('keeps upload order across back-to-back uploads', async () => {
      const { ana, bill } = await setup();
      await photos.add(ana.id, bill.id, [
        await upload(jpeg(), 'a.jpg'),
        await upload(jpeg(), 'b.jpg'),
        await upload(jpeg(), 'c.jpg'),
      ]);
      await photos.add(ana.id, bill.id, [
        await upload(jpeg(), 'd.jpg'),
        await upload(jpeg(), 'e.jpg'),
      ]);

      const found = await bills.findForMember(bill.id, ana.id);

      expect(found.photos?.map((p) => p.name)).toEqual([
        'a.jpg',
        'b.jpg',
        'c.jpg',
        'd.jpg',
        'e.jpg',
      ]);
    });

    it("deletes a bill's photo files with the bill", async () => {
      const { ana, bill } = await setup();
      await photos.add(ana.id, bill.id, [
        await upload(jpeg()),
        await upload(jpeg()),
      ]);

      await bills.delete(ana.id, bill.id);

      expect(await photoCount()).toBe(0);
      expect(await storedFiles()).toEqual([]);
    });

    it('waits for an upload in progress before deleting the bill, and removes its files too', async () => {
      const { ana, bill } = await setup();
      // An upload in progress holds the bill lock and has written a file.
      const uploading = dataSource.createQueryRunner();
      await uploading.connect();
      await uploading.startTransaction();
      let committed = false;
      try {
        await uploading.query(
          'SELECT id FROM bills WHERE id = $1 FOR NO KEY UPDATE',
          [bill.id],
        );
        const { identifiers } = await uploading.manager
          .getRepository(BillPhoto)
          .insert({
            billId: bill.id,
            name: 'u.jpg',
            width: 1,
            height: 1,
            sizeBytes: 1,
          });
        const photoId = identifiers[0].id as string;
        await storage.write(photoId, await jpeg());

        const deleting = bills.delete(ana.id, bill.id);
        await waitForLockWait(dataSource);
        await uploading.commitTransaction();
        committed = true;
        await deleting;

        expect(await storedFiles()).toEqual([]);
      } finally {
        if (!committed) {
          await uploading.rollbackTransaction();
        }
        await uploading.release();
      }
    });
  });
});
