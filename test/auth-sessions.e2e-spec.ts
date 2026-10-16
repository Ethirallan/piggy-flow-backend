import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  DEFAULT_PASSWORD,
  registerUser,
  resetDatabase,
} from './helpers.js';

describe('refresh and logout (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(() => app.close());

  beforeEach(() => resetDatabase(app));

  const refresh = (refreshToken: string) =>
    request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken });

  const login = async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ana@example.com', password: DEFAULT_PASSWORD })
      .expect(200);
    return res.body as { accessToken: string; refreshToken: string };
  };

  it('rotates the refresh token and ends the session when an old one comes back', async () => {
    const { refreshToken } = await registerUser(app);

    const first = await refresh(refreshToken).expect(200);
    expect(first.body).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
    expect(first.body.refreshToken).not.toBe(refreshToken);

    await refresh(refreshToken).expect(401);
    await refresh(first.body.refreshToken).expect(401);
  });

  it('lets exactly one of two simultaneous refreshes win', async () => {
    const { refreshToken } = await registerUser(app);

    const results = await Promise.all([
      refresh(refreshToken),
      refresh(refreshToken),
    ]);

    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 401,
    ]);
  });

  it('answers 401 for a made-up token and 400 for a missing one', async () => {
    await refresh('not-a-token').expect(401);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({})
      .expect(400);
  });

  it('logs out one session', async () => {
    const { refreshToken } = await registerUser(app);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken })
      .expect(204);

    await refresh(refreshToken).expect(401);
  });

  it('answers 204 to logout with a token that matches nothing', () =>
    request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: 'nope' })
      .expect(204));

  it('logs out every session of the user', async () => {
    const phone = await registerUser(app);
    const laptop = await login();

    await request(app.getHttpServer())
      .post('/auth/logout-all')
      .set('Authorization', `Bearer ${phone.accessToken}`)
      .expect(204);

    await refresh(phone.refreshToken).expect(401);
    await refresh(laptop.refreshToken).expect(401);
  });

  it('requires an access token for logout-all', () =>
    request(app.getHttpServer()).post('/auth/logout-all').expect(401));
});
