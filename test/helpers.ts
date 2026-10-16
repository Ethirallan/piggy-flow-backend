import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { inject } from 'vitest';
import { configureApp } from '../src/app.setup.js';
import { truncateTables } from './db.js';

export const TEST_JWT_SECRET = 'e2e-jwt-secret-that-is-at-least-32-chars';

/**
 * Builds the real AppModule against the test database. AppModule reads the
 * environment when it is imported, so the env is set first and the module is
 * imported afterwards.
 */
export async function createTestApp(): Promise<NestExpressApplication> {
  Object.assign(process.env, inject('dbEnv'), {
    JWT_SECRET: TEST_JWT_SECRET,
    LOG_LEVEL: 'silent',
  });
  const { AppModule } = await import('../src/app.module.js');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}

/** Empties every table except the migrations log. */
export function resetDatabase(app: INestApplication): Promise<void> {
  return truncateTables(app.get(DataSource));
}

export const DEFAULT_PASSWORD = 'correct horse battery staple';

export interface RegisteredUser {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; displayName: string; createdAt: string };
  password: string;
}

export async function registerUser(
  app: INestApplication,
  email = 'ana@example.com',
): Promise<RegisteredUser> {
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: DEFAULT_PASSWORD, displayName: 'Ana' })
    .expect(201);
  return {
    ...(res.body as Omit<RegisteredUser, 'password'>),
    password: DEFAULT_PASSWORD,
  };
}
