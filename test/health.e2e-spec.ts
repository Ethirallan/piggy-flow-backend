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

  it('fails slow queries, lock waits and idle transactions instead of hanging', async () => {
    const [row] = await app.get(DataSource).query(
      `SELECT current_setting('statement_timeout') AS statement,
              current_setting('lock_timeout') AS lock,
              current_setting('idle_in_transaction_session_timeout') AS idle`,
    );
    expect(row).toEqual({ statement: '30s', lock: '10s', idle: '1min' });
  });

  it('stops waiting for a pool connection after 10 seconds', () => {
    // The pg pool applies this both to opening a connection and to waiting
    // for a free one when all are checked out.
    const { master } = app.get(DataSource).driver as unknown as {
      master: { options: { connectionTimeoutMillis?: number } };
    };
    expect(master.options.connectionTimeoutMillis).toBe(10_000);
  });
});
