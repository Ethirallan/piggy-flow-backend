import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  DEFAULT_PASSWORD,
  registerUser,
  resetDatabase,
} from './helpers.js';

const NEW_PASSWORD = 'a brand new passphrase';

describe('POST /auth/change-password (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(() => app.close());

  beforeEach(() => resetDatabase(app));

  const login = (password: string) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ana@example.com', password });

  const refresh = (refreshToken: string) =>
    request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken });

  const changePassword = (accessToken: string, body: object) =>
    request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);

  it('changes the password, keeps this device and signs out the others', async () => {
    const phone = await registerUser(app);
    const laptop = (await login(DEFAULT_PASSWORD).expect(200)).body;

    const res = await changePassword(phone.accessToken, {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(200);

    await refresh(res.body.refreshToken).expect(200);
    await refresh(phone.refreshToken).expect(401);
    await refresh(laptop.refreshToken).expect(401);
    await login(DEFAULT_PASSWORD).expect(401);
    await login(NEW_PASSWORD).expect(200);
  });

  it('answers 403 for a wrong current password and keeps the old one', async () => {
    const phone = await registerUser(app);

    const res = await changePassword(phone.accessToken, {
      currentPassword: 'not my password',
      newPassword: NEW_PASSWORD,
    }).expect(403);

    expect(res.body.message).toBe('Current password is incorrect');
    await login(DEFAULT_PASSWORD).expect(200);
  });

  it('answers 400 for a new password that is too short', async () => {
    const phone = await registerUser(app);
    await changePassword(phone.accessToken, {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: 'short',
    }).expect(400);
  });

  it('requires an access token', () =>
    request(app.getHttpServer())
      .post('/auth/change-password')
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: NEW_PASSWORD })
      .expect(401));
});
