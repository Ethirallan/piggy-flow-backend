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

    it('counts the name limit in code points, like the database', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const accountId = await personalAccountId(ana);

      // '❤️' is two code points: 51 of them are 102 > 100.
      await ana
        .post(`/accounts/${accountId}/shops`)
        .send({ name: '❤️'.repeat(51) })
        .expect(400);
      await ana
        .post(`/accounts/${accountId}/shops`)
        .send({ name: '❤️'.repeat(50) })
        .expect(201);
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

  describe('PATCH and DELETE /accounts/:accountId/shops/:id', () => {
    const createShop = async (as: As, accountId: string, name: string) =>
      (
        (
          await as
            .post(`/accounts/${accountId}/shops`)
            .send({ name })
            .expect(201)
        ).body as { id: string; updatedAt: string }
      ).id;

    it('renames a shop and trims the name', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const accountId = await personalAccountId(ana);
      const id = await createShop(ana, accountId, 'Lidl');

      const res = await ana
        .patch(`/accounts/${accountId}/shops/${id}`)
        .send({ name: ' Lidl Center ' })
        .expect(200);

      expect(res.body).toMatchObject({ id, accountId, name: 'Lidl Center' });
      expect(await shopNames(ana, accountId)).toEqual(['Lidl Center']);
    });

    it('renames a shop to its own name in another case', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const accountId = await personalAccountId(ana);
      const id = await createShop(ana, accountId, 'lidl');

      const res = await ana
        .patch(`/accounts/${accountId}/shops/${id}`)
        .send({ name: 'Lidl' })
        .expect(200);

      expect(res.body).toMatchObject({ id, name: 'Lidl' });
      expect(await shopNames(ana, accountId)).toEqual(['Lidl']);
    });

    it('answers 409 when renaming to a name the account already has in another case', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const accountId = await personalAccountId(ana);
      await createShop(ana, accountId, 'Lidl');
      const id = await createShop(ana, accountId, 'Spar');

      await ana
        .patch(`/accounts/${accountId}/shops/${id}`)
        .send({ name: 'lidl' })
        .expect(409);

      expect(await shopNames(ana, accountId)).toEqual(['Lidl', 'Spar']);
    });

    it('deletes a shop; a second delete answers 404', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const accountId = await personalAccountId(ana);
      const id = await createShop(ana, accountId, 'Lidl');

      await ana.delete(`/accounts/${accountId}/shops/${id}`).expect(204);
      await ana.delete(`/accounts/${accountId}/shops/${id}`).expect(404);

      expect(await shopNames(ana, accountId)).toEqual([]);
    });

    it("answers 404 for a shop of another of the user's accounts, and changes nothing", async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const personal = await personalAccountId(ana);
      const home = await createAccount(ana, 'Home');
      const id = await createShop(ana, home, 'Lidl');

      const res = await ana
        .patch(`/accounts/${personal}/shops/${id}`)
        .send({ name: 'Mine' })
        .expect(404);
      await ana.delete(`/accounts/${personal}/shops/${id}`).expect(404);

      expect(res.body.message).toBe('Shop not found');
      expect(await shopNames(ana, home)).toEqual(['Lidl']);
    });

    it("answers 404 for someone else's account", async () => {
      const ana = asUser(
        app,
        (await registerUser(app, 'ana@example.com')).accessToken,
      );
      const bob = asUser(
        app,
        (await registerUser(app, 'bob@example.com')).accessToken,
      );
      const anas = await personalAccountId(ana);
      const id = await createShop(ana, anas, 'Lidl');

      await bob
        .patch(`/accounts/${anas}/shops/${id}`)
        .send({ name: 'Mine' })
        .expect(404);
      await bob.delete(`/accounts/${anas}/shops/${id}`).expect(404);

      expect(await shopNames(ana, anas)).toEqual(['Lidl']);
    });

    it('answers 400 for a blank name and for a shop id that is not a UUID', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const accountId = await personalAccountId(ana);
      const id = await createShop(ana, accountId, 'Lidl');

      await ana
        .patch(`/accounts/${accountId}/shops/${id}`)
        .send({ name: ' ' })
        .expect(400);
      await ana
        .patch(`/accounts/${accountId}/shops/123`)
        .send({ name: 'X' })
        .expect(400);
      await ana.delete(`/accounts/${accountId}/shops/123`).expect(400);
    });
  });
});
