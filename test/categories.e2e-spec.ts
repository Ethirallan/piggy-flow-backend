import type { INestApplication } from '@nestjs/common';
import {
  asUser,
  createTestApp,
  registerUser,
  resetDatabase,
} from './helpers.js';

type As = ReturnType<typeof asUser>;

describe('categories (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(() => app.close());

  beforeEach(() => resetDatabase(app));

  const personalAccountId = async (as: As) =>
    ((await as.get('/accounts').expect(200)).body as { id: string }[])[0].id;
  const categories = async (as: As, accountId: string) =>
    (await as.get(`/accounts/${accountId}/categories`).expect(200)).body as {
      name: string;
      emoji: string | null;
    }[];

  describe('GET and POST /accounts/:accountId/categories', () => {
    it('creates categories with and without an emoji and lists them by name', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const accountId = await personalAccountId(ana);

      const res = await ana
        .post(`/accounts/${accountId}/categories`)
        .send({ name: ' rent ' })
        .expect(201);
      await ana
        .post(`/accounts/${accountId}/categories`)
        .send({ name: 'Food', emoji: '🛒' })
        .expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        accountId,
        name: 'rent',
        emoji: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(
        (await categories(ana, accountId)).map((c) => [c.name, c.emoji]),
      ).toEqual([
        ['Food', '🛒'],
        ['rent', null],
      ]);
    });

    it('answers 409 for a name the account already has in another case', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const accountId = await personalAccountId(ana);
      await ana
        .post(`/accounts/${accountId}/categories`)
        .send({ name: 'Food' })
        .expect(201);

      const res = await ana
        .post(`/accounts/${accountId}/categories`)
        .send({ name: 'FOOD' })
        .expect(409);

      expect(res.body.message).toBe('A category with that name already exists');
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

      await bob.get(`/accounts/${anas}/categories`).expect(404);
      await bob
        .post(`/accounts/${anas}/categories`)
        .send({ name: 'Food' })
        .expect(404);
      expect(await categories(ana, anas)).toEqual([]);
    });

    it.each([
      ['a blank name', { name: ' ' }],
      ['a missing name', { emoji: '🛒' }],
      ['two emojis', { name: 'Food', emoji: '🛒🛒' }],
      ['text as the emoji', { name: 'Food', emoji: 'cart' }],
      ['a number as the emoji', { name: 'Food', emoji: 5 }],
    ])('answers 400 for %s', async (_case, body) => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const accountId = await personalAccountId(ana);

      await ana
        .post(`/accounts/${accountId}/categories`)
        .send(body)
        .expect(400);

      expect(await categories(ana, accountId)).toEqual([]);
    });
  });
});
