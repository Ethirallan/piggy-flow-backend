import { execSync } from 'node:child_process';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

let container: StartedPostgreSqlContainer | undefined;

/**
 * Starts a throwaway Postgres, applies the migrations from the compiled build
 * (the same way production does), and fails if the entities and migrations
 * have drifted apart. Shared by the integration and e2e test runs.
 */
export async function setup(project: TestProject): Promise<void> {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const dbEnv = {
    DB_HOST: container.getHost(),
    DB_PORT: String(container.getPort()),
    DB_USERNAME: container.getUsername(),
    DB_PASSWORD: container.getPassword(),
    DB_DATABASE: container.getDatabase(),
  };
  const run = (command: string) =>
    execSync(command, { env: { ...process.env, ...dbEnv }, stdio: 'inherit' });

  run('pnpm build');
  run('pnpm exec typeorm migration:run -d dist/database-source.js');
  run(
    'pnpm exec typeorm migration:generate --check -d dist/database-source.js src/migrations/SchemaDrift',
  );

  project.provide('dbEnv', dbEnv);
}

export async function teardown(): Promise<void> {
  await container?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    dbEnv: Record<string, string>;
  }
}
