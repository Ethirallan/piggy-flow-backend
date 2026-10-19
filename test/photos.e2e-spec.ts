import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { jpeg } from './images.js';
import {
  asUser,
  createTestApp,
  registerUser,
  resetDatabase,
} from './helpers.js';

type As = ReturnType<typeof asUser>;

interface PhotoBody {
  id: string;
  name: string;
  width: number;
  height: number;
  sizeBytes: number;
}

describe('bill photos (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(() => app.close());

  const incomingDir = () => join(process.env.UPLOADS_DIR!, '.incoming');
  // The interceptor's deletes aren't awaited by the response, so poll briefly.
  const incoming = async () => {
    let names = await readdir(incomingDir());
    for (let i = 0; i < 50 && names.length > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      names = await readdir(incomingDir());
    }
    return names;
  };

  beforeEach(async () => {
    await resetDatabase(app);
    for (const name of await readdir(incomingDir())) {
      await rm(join(incomingDir(), name), { force: true });
    }
  });
  const personalAccountId = async (as: As) =>
    ((await as.get('/accounts').expect(200)).body as { id: string }[])[0].id;
  const createBill = async (as: As) => {
    const accountId = await personalAccountId(as);
    const created = await as
      .post('/bills')
      .send({ accountId, date: '2026-10-16T13:26:00+02:00', priceCents: 100 })
      .expect(201);
    return (created.body as { id: string }).id;
  };

  it('uploads, downloads and deletes photos', async () => {
    const ana = asUser(app, (await registerUser(app)).accessToken);
    const billId = await createBill(ana);

    const uploaded = await ana
      .post(`/bills/${billId}/photos`)
      .attach(
        'files',
        await jpeg(4000, 3000, { orientation: 6 }),
        'receipt.jpg',
      )
      .attach('files', await jpeg(640, 480), 'second.png')
      .expect(201);
    const [first] = uploaded.body as PhotoBody[];
    const download = await ana
      .get(`/bills/${billId}/photos/${first.id}`)
      .buffer(true)
      .expect(200);

    expect(uploaded.body).toEqual([
      {
        id: expect.any(String),
        name: 'receipt.jpg',
        width: 1920,
        height: 2560,
        sizeBytes: expect.any(Number),
        createdAt: expect.any(String),
      },
      expect.objectContaining({ name: 'second.png', width: 640, height: 480 }),
    ]);
    expect(download.headers).toMatchObject({
      'content-type': 'image/jpeg',
      'content-length': String(first.sizeBytes),
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=31536000, immutable',
      'content-disposition': `inline; filename="photo.jpg"; filename*=UTF-8''receipt.jpg`,
    });
    expect((download.body as Buffer).subarray(0, 3)).toEqual(
      Buffer.from([0xff, 0xd8, 0xff]),
    );

    await ana.delete(`/bills/${billId}/photos/${first.id}`).expect(204);
    await ana.get(`/bills/${billId}/photos/${first.id}`).expect(404);
    expect(await incoming()).toEqual([]);
  });

  it("answers 404 for someone else's bill and for a photo of another bill, and leaves no temp files", async () => {
    const ana = asUser(
      app,
      (await registerUser(app, 'ana@example.com')).accessToken,
    );
    const bob = asUser(
      app,
      (await registerUser(app, 'bob@example.com', 'Bob')).accessToken,
    );
    const billId = await createBill(ana);
    const otherBill = await createBill(ana);
    const [photo] = (
      await ana
        .post(`/bills/${billId}/photos`)
        .attach('files', await jpeg(), 'r.jpg')
        .expect(201)
    ).body as PhotoBody[];

    await bob
      .post(`/bills/${billId}/photos`)
      .attach('files', await jpeg(), 'r.jpg')
      .expect(404);
    await bob.get(`/bills/${billId}/photos/${photo.id}`).expect(404);
    await bob.delete(`/bills/${billId}/photos/${photo.id}`).expect(404);
    await ana.get(`/bills/${otherBill}/photos/${photo.id}`).expect(404);
    await ana.get(`/bills/${billId}/photos/${randomUUID()}`).expect(404);
    await ana.get(`/bills/${billId}/photos/${photo.id}`).expect(200);
    expect(await incoming()).toEqual([]);
  });

  it('answers 400 for a non-image, no files, too many files and malformed ids, leaving no temp files', async () => {
    const ana = asUser(app, (await registerUser(app)).accessToken);
    const billId = await createBill(ana);

    const fake = await ana
      .post(`/bills/${billId}/photos`)
      .attach('files', Buffer.from('not an image'), 'fake.jpg')
      .expect(400);
    await ana.post(`/bills/${billId}/photos`).expect(400);
    const eleven = ana.post(`/bills/${billId}/photos`);
    for (let i = 0; i < 11; i++) {
      eleven.attach('files', await jpeg(), `r${i}.jpg`);
    }
    await eleven.expect(400);
    await ana
      .post('/bills/not-a-uuid/photos')
      .attach('files', await jpeg(), 'r.jpg')
      .expect(400);
    await ana.get(`/bills/${billId}/photos/123`).expect(400);

    expect(fake.body.message).toBe('Unsupported image');
    expect(await incoming()).toEqual([]);
  });

  it('answers 413 for a file over 15 MB', async () => {
    const ana = asUser(app, (await registerUser(app)).accessToken);
    const billId = await createBill(ana);

    await ana
      .post(`/bills/${billId}/photos`)
      .attach('files', Buffer.alloc(15 * 1024 * 1024 + 1), 'big.jpg')
      .expect(413);

    expect(await incoming()).toEqual([]);
  });

  it('answers 409 for the 11th photo', async () => {
    const ana = asUser(app, (await registerUser(app)).accessToken);
    const billId = await createBill(ana);
    const ten = ana.post(`/bills/${billId}/photos`);
    for (let i = 0; i < 10; i++) {
      ten.attach('files', await jpeg(), `r${i}.jpg`);
    }
    await ten.expect(201);

    const res = await ana
      .post(`/bills/${billId}/photos`)
      .attach('files', await jpeg(), 'r.jpg')
      .expect(409);

    expect(res.body.message).toBe('A bill can have at most 10 photos');
  });

  it('requires an access token', async () => {
    await request(app.getHttpServer())
      .post(`/bills/${randomUUID()}/photos`)
      .attach('files', await jpeg(), 'r.jpg')
      .expect(401);
    expect(await incoming()).toEqual([]);
  });
  it('includes photos in bill responses and removes them with the bill', async () => {
    const ana = asUser(app, (await registerUser(app)).accessToken);
    const billId = await createBill(ana);
    const [photo] = (
      await ana
        .post(`/bills/${billId}/photos`)
        .attach('files', await jpeg(), 'r.jpg')
        .expect(201)
    ).body as PhotoBody[];

    const one = await ana.get(`/bills/${billId}`).expect(200);
    const list = await ana.get('/bills').expect(200);
    await ana.delete(`/bills/${billId}`).expect(204);

    expect(one.body.photos).toEqual([
      {
        id: photo.id,
        name: 'r.jpg',
        width: photo.width,
        height: photo.height,
        sizeBytes: photo.sizeBytes,
        createdAt: expect.any(String),
      },
    ]);
    expect(list.body.items[0].photos).toHaveLength(1);
    expect(await readdir(process.env.UPLOADS_DIR!)).not.toContain(
      `${photo.id}.jpg`,
    );
  });
});
