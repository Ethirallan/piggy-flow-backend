import type { ModuleMetadata } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
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
      // Global, as in AuthModule: controllers' LoggingThrottlerGuard needs it.
      ThrottlerModule.forRoot({ throttlers: [{ limit: 10, ttl: 60_000 }] }),
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
