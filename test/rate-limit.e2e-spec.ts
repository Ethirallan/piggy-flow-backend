import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  asUser,
  createTestApp,
  DEFAULT_PASSWORD,
  registerUser,
  resetDatabase,
} from './helpers.js';

const badLogin = { email: 'ana@example.com', password: 'wrong password' };

describe('rate limits (e2e)', () => {
  describe('without a proxy', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createTestApp({ rateLimit: true });
      await resetDatabase(app);
    });

    afterAll(() => app.close());

    it('allows 5 login attempts per minute, then answers 429', async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .send(badLogin)
          .expect(401);
      }
      await request(app.getHttpServer())
        .post('/auth/login')
        .send(badLogin)
        .expect(429);
    });

    it('allows 5 password-change attempts per minute, then answers 429', async () => {
      const { accessToken } = await registerUser(app);
      const changePassword = () =>
        request(app.getHttpServer())
          .post('/auth/change-password')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            currentPassword: 'not my password',
            newPassword: DEFAULT_PASSWORD,
          });

      for (let attempt = 0; attempt < 5; attempt++) {
        await changePassword().expect(403);
      }
      await changePassword().expect(429);
    });

    it('allows 10 member additions per minute, then answers 429', async () => {
      const { accessToken } = await registerUser(app, 'adder@example.com');
      const adder = asUser(app, accessToken);
      const home = await adder.post('/accounts').send({ name: 'Home' });
      const addMember = (email: string) =>
        adder
          .post(`/accounts/${(home.body as { id: string }).id}/members`)
          .send({ email });

      for (let attempt = 0; attempt < 10; attempt++) {
        await addMember(`nobody${attempt}@example.com`).expect(404);
      }
      await addMember('nobody@example.com').expect(429);
    });

    it('does not limit other routes', async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        await request(app.getHttpServer()).get('/health').expect(200);
      }
    });
  });

  describe('behind one trusted proxy', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createTestApp({ rateLimit: true, trustProxy: '1' });
      await resetDatabase(app);
    });

    afterAll(() => app.close());

    const loginFrom = (clientIp: string) =>
      request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', clientIp)
        .send(badLogin);

    it('counts each client IP separately', async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        await loginFrom('203.0.113.1').expect(401);
      }
      await loginFrom('203.0.113.1').expect(429);
      await loginFrom('203.0.113.2').expect(401);
    });
  });
});
