import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  asUser,
  createTestApp,
  registerUser,
  resetDatabase,
} from './helpers.js';

type As = ReturnType<typeof asUser>;

describe('shops (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(() => app.close());

  beforeEach(() => resetDatabase(app));

  const personalAccountId = async (as: As) =>
    ((await as.get('/accounts').expect(200)).body as { id: string }[])[0].id;
  const createAccount = async (as: As, name: string) =>
    (
      (await as.post('/accounts').send({ name }).expect(201)).body as {
        id: string;
      }
    ).id;
  const shopNames = async (as: As, accountId: string) =>
    (
      (await as.get(`/accounts/${accountId}/shops`).expect(200)).body as {
        name: string;
      }[]
    ).map((shop) => shop.name);

  describe('GET and POST /accounts/:accountId/shops', () => {
    it('starts empty, creates shops with trimmed names and lists them by name', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const accountId = await personalAccountId(ana);
      expect(await shopNames(ana, accountId)).toEqual([]);

      const res = await ana
        .post(`/accounts/${accountId}/shops`)
        .send({ name: '  spar ' })
        .expect(201);
      await ana
        .post(`/accounts/${accountId}/shops`)
        .send({ name: 'Hofer' })
        .expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        accountId,
        name: 'spar',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(await shopNames(ana, accountId)).toEqual(['Hofer', 'spar']);
    });

    it('answers 409 for a name the account already has in another case, but allows it elsewhere', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const personal = await personalAccountId(ana);
      const home = await createAccount(ana, 'Home');
      await ana
        .post(`/accounts/${personal}/shops`)
        .send({ name: 'Lidl' })
        .expect(201);

      const res = await ana
        .post(`/accounts/${personal}/shops`)
        .send({ name: 'LIDL' })
        .expect(409);
      await ana
        .post(`/accounts/${home}/shops`)
        .send({ name: 'LIDL' })
        .expect(201);

      expect(res.body.message).toBe('A shop with that name already exists');
    });

    it("answers 404 for someone else's account and for an unknown one", async () => {
      const ana = asUser(
        app,
        (await registerUser(app, 'ana@example.com')).accessToken,
      );
      const bob = asUser(
        app,
        (await registerUser(app, 'bob@example.com')).accessToken,
      );
      const anas = await personalAccountId(ana);

      await bob.get(`/accounts/${anas}/shops`).expect(404);
      await bob
        .post(`/accounts/${anas}/shops`)
        .send({ name: 'Lidl' })
        .expect(404);
      await bob.get(`/accounts/${randomUUID()}/shops`).expect(404);
      expect(await shopNames(ana, anas)).toEqual([]);
    });

    it.each([
      ['a blank name', { name: '   ' }],
      ['a 101-character name', { name: 'a'.repeat(101) }],
      ['a missing name', {}],
      ['an accountId field', { name: 'Lidl', accountId: randomUUID() }],
    ])('answers 400 for %s', async (_case, body) => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const accountId = await personalAccountId(ana);

      await ana.post(`/accounts/${accountId}/shops`).send(body).expect(400);

      expect(await shopNames(ana, accountId)).toEqual([]);
    });

    it('answers 400 for an account id that is not a UUID, and 401 without a token', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);

      await ana.get('/accounts/not-a-uuid/shops').expect(400);
      await request(app.getHttpServer())
        .get(`/accounts/${randomUUID()}/shops`)
        .expect(401);
    });
  });
});
