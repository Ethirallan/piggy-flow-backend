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
});
