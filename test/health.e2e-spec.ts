import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './helpers.js';

describe('app (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(() => app.close());

  it('answers /health', () =>
    request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' }));

  it('runs against the migrated schema', async () => {
    const [row] = await app
      .get(DataSource)
      .query(`SELECT to_regclass('public.users') AS users`);
    expect(row.users).toBe('users');
  });
});
