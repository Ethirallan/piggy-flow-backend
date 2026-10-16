import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';

const { DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE } = process.env;

export const dataSourceOption: DataSourceOptions = {
  type: 'postgres',
  host: DB_HOST,
  port: parseInt(DB_PORT || '5432'),
  username: DB_USERNAME,
  password: DB_PASSWORD,
  database: DB_DATABASE,
  // Compiled files only: TypeORM imports these with Node's own import(),
  // which can't run decorated TypeScript. The app itself registers entities
  // through TypeOrmModule.forFeature (autoLoadEntities in app.module.ts).
  entities: [`${import.meta.dirname}/**/*.entity.js`],
  migrations: [`${import.meta.dirname}/**/migrations/*.js`],
  // gen_random_uuid() is built into Postgres 13+, unlike uuid-ossp.
  uuidExtension: 'pgcrypto',
  synchronize: false,
  migrationsRun: true,
};

export default new DataSource(dataSourceOption);
