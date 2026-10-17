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
  const createAccount = async (as: As, name: string) =>
    (
      (await as.post('/accounts').send({ name }).expect(201)).body as {
        id: string;
      }
    ).id;
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

  describe('PATCH and DELETE /accounts/:accountId/categories/:id', () => {
    const createCategory = async (as: As, accountId: string, body: object) =>
      (
        (
          await as
            .post(`/accounts/${accountId}/categories`)
            .send(body)
            .expect(201)
        ).body as { id: string }
      ).id;

    it('changes only the fields sent; null clears the emoji', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const accountId = await personalAccountId(ana);
      const id = await createCategory(ana, accountId, {
        name: 'Food',
        emoji: '🛒',
      });
      const url = `/accounts/${accountId}/categories/${id}`;

      const renamed = await ana
        .patch(url)
        .send({ name: ' Groceries ' })
        .expect(200);
      expect(renamed.body).toMatchObject({ name: 'Groceries', emoji: '🛒' });

      const newEmoji = await ana.patch(url).send({ emoji: '🥦' }).expect(200);
      expect(newEmoji.body).toMatchObject({ name: 'Groceries', emoji: '🥦' });

      const cleared = await ana.patch(url).send({ emoji: null }).expect(200);
      expect(cleared.body).toMatchObject({ name: 'Groceries', emoji: null });
    });

    it.each([
      ['an empty body', {}],
      ['a null name', { name: null }],
      ['a blank name', { name: ' ' }],
      ['two emojis', { emoji: '🛒🛒' }],
    ])('answers 400 for %s and changes nothing', async (_case, body) => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const accountId = await personalAccountId(ana);
      const id = await createCategory(ana, accountId, {
        name: 'Food',
        emoji: '🛒',
      });

      await ana
        .patch(`/accounts/${accountId}/categories/${id}`)
        .send(body)
        .expect(400);

      expect(
        (await categories(ana, accountId)).map((c) => [c.name, c.emoji]),
      ).toEqual([['Food', '🛒']]);
    });

    it('answers 409 when renaming to a name the account already has in another case', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const accountId = await personalAccountId(ana);
      await createCategory(ana, accountId, { name: 'Food' });
      const id = await createCategory(ana, accountId, { name: 'Rent' });

      await ana
        .patch(`/accounts/${accountId}/categories/${id}`)
        .send({ name: 'food' })
        .expect(409);
    });

    it('deletes a category; a second delete answers 404', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const accountId = await personalAccountId(ana);
      const id = await createCategory(ana, accountId, { name: 'Food' });

      await ana.delete(`/accounts/${accountId}/categories/${id}`).expect(204);
      await ana.delete(`/accounts/${accountId}/categories/${id}`).expect(404);
      expect(await categories(ana, accountId)).toEqual([]);
    });

    it("answers 404 for a category of another of the user's accounts, and changes nothing", async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const personal = await personalAccountId(ana);
      const home = await createAccount(ana, 'Home');
      const id = await createCategory(ana, home, { name: 'Food' });

      const res = await ana
        .patch(`/accounts/${personal}/categories/${id}`)
        .send({ name: 'Mine' })
        .expect(404);
      await ana.delete(`/accounts/${personal}/categories/${id}`).expect(404);

      expect(res.body.message).toBe('Category not found');
      expect((await categories(ana, home)).map((c) => c.name)).toEqual([
        'Food',
      ]);
    });

    it("answers 404 for someone else's account and 400 for a category id that is not a UUID", async () => {
      const ana = asUser(
        app,
        (await registerUser(app, 'ana@example.com')).accessToken,
      );
      const bob = asUser(
        app,
        (await registerUser(app, 'bob@example.com')).accessToken,
      );
      const anas = await personalAccountId(ana);
      const id = await createCategory(ana, anas, { name: 'Food' });

      await bob
        .patch(`/accounts/${anas}/categories/${id}`)
        .send({ name: 'X' })
        .expect(404);
      await bob.delete(`/accounts/${anas}/categories/${id}`).expect(404);
      await ana.delete(`/accounts/${anas}/categories/123`).expect(400);
    });
  });
});
