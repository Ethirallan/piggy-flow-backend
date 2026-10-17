import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  asUser,
  createTestApp,
  registerUser,
  resetDatabase,
} from './helpers.js';

interface AccountBody {
  id: string;
  name: string;
  isPersonal: boolean;
}

describe('accounts (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(() => app.close());

  beforeEach(() => resetDatabase(app));

  const names = (body: AccountBody[]) => body.map((account) => account.name);

  describe('GET /accounts and POST /accounts', () => {
    it('lists the Personal account of a new user', async () => {
      const ana = await registerUser(app);

      const res = await asUser(app, ana.accessToken)
        .get('/accounts')
        .expect(200);

      expect(res.body).toEqual([
        {
          id: expect.any(String),
          name: 'Personal',
          isPersonal: true,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      ]);
    });

    it('creates shared accounts with trimmed names and lists them after Personal, by name', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);

      const created = await ana
        .post('/accounts')
        .send({ name: '  zoo trip ' })
        .expect(201);
      await ana.post('/accounts').send({ name: 'Groceries' }).expect(201);

      expect(created.body).toMatchObject({
        name: 'zoo trip',
        isPersonal: false,
      });
      const res = await ana.get('/accounts').expect(200);
      expect(names(res.body)).toEqual(['Personal', 'Groceries', 'zoo trip']);
    });

    it("does not list other users' accounts", async () => {
      const ana = await registerUser(app, 'ana@example.com');
      const bob = await registerUser(app, 'bob@example.com');
      await asUser(app, ana.accessToken)
        .post('/accounts')
        .send({ name: 'Ana only' })
        .expect(201);

      const res = await asUser(app, bob.accessToken)
        .get('/accounts')
        .expect(200);

      expect(names(res.body)).toEqual(['Personal']);
    });

    it.each([
      ['a blank name', { name: '   ' }],
      ['a 101-character name', { name: 'a'.repeat(101) }],
      ['a missing name', {}],
      ['an isPersonal field', { name: 'Mine', isPersonal: true }],
    ])('answers 400 for %s', async (_case, body) => {
      const ana = asUser(app, (await registerUser(app)).accessToken);

      await ana.post('/accounts').send(body).expect(400);

      expect(names((await ana.get('/accounts')).body)).toEqual(['Personal']);
    });

    it('requires an access token', async () => {
      await request(app.getHttpServer()).get('/accounts').expect(401);
      await request(app.getHttpServer())
        .post('/accounts')
        .send({ name: 'Home' })
        .expect(401);
    });
  });

  describe('GET /accounts/:id', () => {
    it('returns the account with its members', async () => {
      const registered = await registerUser(app);
      const ana = asUser(app, registered.accessToken);
      const { id } = (await ana.post('/accounts').send({ name: 'Home' }))
        .body as AccountBody;

      const res = await ana.get(`/accounts/${id}`).expect(200);

      expect(res.body).toEqual({
        id,
        name: 'Home',
        isPersonal: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        members: [
          {
            userId: registered.user.id,
            displayName: 'Ana',
            email: 'ana@example.com',
            joinedAt: expect.any(String),
          },
        ],
      });
    });

    it("answers 404 for someone else's account and for an unknown id", async () => {
      const ana = asUser(
        app,
        (await registerUser(app, 'ana@example.com')).accessToken,
      );
      const bob = asUser(
        app,
        (await registerUser(app, 'bob@example.com')).accessToken,
      );
      const { id } = (await ana.post('/accounts').send({ name: 'Home' }))
        .body as AccountBody;

      await bob.get(`/accounts/${id}`).expect(404);
      await bob.get(`/accounts/${randomUUID()}`).expect(404);
    });

    it('answers 400 for an id that is not a UUID', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      await ana.get('/accounts/not-a-uuid').expect(400);
    });
  });

  describe('PATCH /accounts/:id', () => {
    it('answers 400 for an id that is not a UUID', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      await ana
        .patch('/accounts/not-a-uuid')
        .send({ name: 'Mine' })
        .expect(400);
    });

    it('renames an account, Personal too, and trims the name', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const [personal] = (await ana.get('/accounts')).body as AccountBody[];

      const res = await ana
        .patch(`/accounts/${personal.id}`)
        .send({ name: '  Mine ' })
        .expect(200);

      expect(res.body).toMatchObject({ name: 'Mine', isPersonal: true });
      expect(names((await ana.get('/accounts')).body)).toEqual(['Mine']);
    });

    it("answers 404 for someone else's account and leaves the name", async () => {
      const ana = asUser(
        app,
        (await registerUser(app, 'ana@example.com')).accessToken,
      );
      const bob = asUser(
        app,
        (await registerUser(app, 'bob@example.com')).accessToken,
      );
      const { id } = (await ana.post('/accounts').send({ name: 'Home' }))
        .body as AccountBody;

      await bob.patch(`/accounts/${id}`).send({ name: 'Mine' }).expect(404);

      expect((await ana.get(`/accounts/${id}`)).body.name).toBe('Home');
    });

    it('answers 400 for a blank name', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const { id } = (await ana.post('/accounts').send({ name: 'Home' }))
        .body as AccountBody;

      await ana.patch(`/accounts/${id}`).send({ name: ' ' }).expect(400);
    });
  });

  describe('DELETE /accounts/:id', () => {
    it('answers 400 for an id that is not a UUID', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      await ana.delete('/accounts/not-a-uuid').expect(400);
    });

    it('deletes a shared account', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const { id } = (await ana.post('/accounts').send({ name: 'Home' }))
        .body as AccountBody;

      await ana.delete(`/accounts/${id}`).expect(204);

      await ana.get(`/accounts/${id}`).expect(404);
      expect(names((await ana.get('/accounts')).body)).toEqual(['Personal']);
    });

    it('answers 409 for the Personal account and keeps it', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const [personal] = (await ana.get('/accounts')).body as AccountBody[];

      const res = await ana.delete(`/accounts/${personal.id}`).expect(409);

      expect(res.body.message).toBe("The Personal account can't be deleted");
      await ana.get(`/accounts/${personal.id}`).expect(200);
    });

    it("answers 404 for someone else's account and keeps it", async () => {
      const ana = asUser(
        app,
        (await registerUser(app, 'ana@example.com')).accessToken,
      );
      const bob = asUser(
        app,
        (await registerUser(app, 'bob@example.com')).accessToken,
      );
      const { id } = (await ana.post('/accounts').send({ name: 'Home' }))
        .body as AccountBody;

      await bob.delete(`/accounts/${id}`).expect(404);

      await ana.get(`/accounts/${id}`).expect(200);
    });
  });
});
