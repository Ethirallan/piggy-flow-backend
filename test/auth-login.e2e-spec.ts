import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  createTestApp,
  DEFAULT_PASSWORD,
  registerUser,
  resetDatabase,
} from './helpers.js';

describe('POST /auth/login (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await resetDatabase(app);
    await registerUser(app, 'ana@example.com');
  });

  const login = (body: object) =>
    request(app.getHttpServer()).post('/auth/login').send(body);

  it('logs in with any casing of the email and starts a second session', async () => {
    const res = await login({
      email: ' ANA@Example.com ',
      password: DEFAULT_PASSWORD,
    }).expect(200);

    expect(res.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      user: { email: 'ana@example.com', displayName: 'Ana' },
    });
    const [{ count }] = await app
      .get(DataSource)
      .query(`SELECT count(*)::int AS count FROM sessions`);
    expect(count).toBe(2);
  });

  it('answers a wrong password and an unknown email identically', async () => {
    const wrongPassword = await login({
      email: 'ana@example.com',
      password: 'wrong password',
    }).expect(401);
    const unknownEmail = await login({
      email: 'bob@example.com',
      password: DEFAULT_PASSWORD,
    }).expect(401);

    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.message).toBe('Invalid email or password');
  });

  it('answers 400 for a missing password', () =>
    login({ email: 'ana@example.com' }).expect(400));
});
