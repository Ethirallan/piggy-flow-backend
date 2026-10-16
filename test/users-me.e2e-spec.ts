import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  registerUser,
  resetDatabase,
  type RegisteredUser,
} from './helpers.js';

describe('/users/me (e2e)', () => {
  let app: INestApplication;
  let ana: RegisteredUser;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await resetDatabase(app);
    ana = await registerUser(app);
  });

  const asAna = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ana.accessToken}`);

  it('returns the current user', async () => {
    const res = await asAna(
      request(app.getHttpServer()).get('/users/me'),
    ).expect(200);
    expect(res.body).toEqual(ana.user);
  });

  it('answers 401 without a token', () =>
    request(app.getHttpServer()).get('/users/me').expect(401));

  it('answers 401 for a malformed token', () =>
    request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401));

  it('answers 401 when the refresh token is sent as the access token', () =>
    request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${ana.refreshToken}`)
      .expect(401));

  it('updates the display name, trimmed', async () => {
    const res = await asAna(request(app.getHttpServer()).patch('/users/me'))
      .send({ displayName: '  Ana B ' })
      .expect(200);

    expect(res.body.displayName).toBe('Ana B');
    const me = await asAna(
      request(app.getHttpServer()).get('/users/me'),
    ).expect(200);
    expect(me.body.displayName).toBe('Ana B');
  });

  it.each([
    ['a blank display name', { displayName: '  ' }],
    ['a 101-character display name', { displayName: 'a'.repeat(101) }],
    ['an email change', { displayName: 'Ana', email: 'evil@example.com' }],
  ])('answers 400 for %s', (_case, body) =>
    asAna(request(app.getHttpServer()).patch('/users/me'))
      .send(body)
      .expect(400),
  );
});
