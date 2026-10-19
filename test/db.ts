import type { ModuleMetadata } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { inject } from 'vitest';

/**
 * A Nest testing module connected to the test database, for integration tests
 * of code that talks to Postgres. Pass the modules and providers under test;
 * their entities are registered through TypeOrmModule.forFeature.
 */
export function createIntegrationModule(
  metadata: Pick<ModuleMetadata, 'imports' | 'providers'>,
): Promise<TestingModule> {
  const env = inject('dbEnv');
  return Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'postgres',
        host: env.DB_HOST,
        port: Number(env.DB_PORT),
        username: env.DB_USERNAME,
        password: env.DB_PASSWORD,
        database: env.DB_DATABASE,
        uuidExtension: 'pgcrypto',
        autoLoadEntities: true,
      }),
      ...(metadata.imports ?? []),
    ],
    providers: metadata.providers ?? [],
  }).compile();
}

/** Empties every table except the migrations log. */
export async function truncateTables(dataSource: DataSource): Promise<void> {
  const tables: { tablename: string }[] = await dataSource.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'`,
  );
  if (tables.length > 0) {
    const names = tables.map(({ tablename }) => `"${tablename}"`).join(', ');
    await dataSource.query(`TRUNCATE ${names} CASCADE`);
  }
}

/**
 * Resolves once some backend is waiting on a lock, so a test can commit the
 * transaction that holds it only after the blocked operation really blocked.
 * Run it on a connection outside the blocked ones (it never counts itself).
 */
export async function waitForLockWait(
  dataSource: DataSource,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [{ waiting }]: { waiting: number }[] = await dataSource.query(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
         AND wait_event_type = 'Lock'`,
    );
    if (waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No query started waiting for a lock within ${timeoutMs} ms`);
}
