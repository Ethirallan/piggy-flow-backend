import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp, registerUser, resetDatabase } from './helpers.js';

const valid = {
  email: 'ana@example.com',
  password: 'correct horse',
  displayName: 'Ana',
};

describe('POST /auth/register (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(() => app.close());

  beforeEach(() => resetDatabase(app));

  const register = (body: object) =>
    request(app.getHttpServer()).post('/auth/register').send(body);

  it('creates the user with a normalized email and returns a token pair', async () => {
    const res = await register({
      email: '  Ana@Example.com ',
      password: 'correct horse',
      displayName: '  Ana ',
    }).expect(201);

    expect(res.body).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      user: {
        id: expect.any(String),
        email: 'ana@example.com',
        displayName: 'Ana',
        createdAt: expect.any(String),
      },
    });
  });

  it('gives the new user a Personal account and nothing else', async () => {
    const res = await register(valid).expect(201);

    const rows = await app.get(DataSource).query(
      `SELECT a.name, a.is_personal
         FROM accounts a
         JOIN account_members m ON m.account_id = a.id
        WHERE m.user_id = $1`,
      [res.body.user.id],
    );
    expect(rows).toEqual([{ name: 'Personal', is_personal: true }]);
  });

  it('rejects an email that is already registered, ignoring case and spaces', async () => {
    await registerUser(app, 'ana@example.com');

    const res = await register({ ...valid, email: ' ANA@example.com' }).expect(
      409,
    );

    expect(res.body.message).toBe('Email already registered');
  });

  it('stores an argon2id hash, never the password', async () => {
    await register(valid).expect(201);

    const [row] = await app
      .get(DataSource)
      .query(`SELECT password_hash FROM users WHERE email = 'ana@example.com'`);
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.password_hash).not.toContain('correct horse');
  });

  it.each([
    ['a short password', { ...valid, password: 'short' }],
    ['a 129-character password', { ...valid, password: 'a'.repeat(129) }],
    ['an invalid email', { ...valid, email: 'not-an-email' }],
    ['a blank display name', { ...valid, displayName: '   ' }],
    [
      'a missing display name',
      { email: valid.email, password: valid.password },
    ],
    ['an unknown field', { ...valid, admin: true }],
  ])('answers 400 for %s', async (_case, body) => {
    await register(body).expect(400);
    const [{ count }] = await app
      .get(DataSource)
      .query(`SELECT count(*)::int AS count FROM users`);
    expect(count).toBe(0);
  });

  it('answers 400 for malformed JSON', () =>
    request(app.getHttpServer())
      .post('/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"email": ')
      .expect(400));
});
