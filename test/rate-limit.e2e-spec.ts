import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './helpers.js';

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
