import 'reflect-metadata';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

// Load .env when present (local runs). In Docker the variables come from env_file.
try {
  (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.();
} catch {
  // no .env file: rely on the environment
}

export default new DataSource({
  type: 'mariadb',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  entities: [join(__dirname, '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
});
