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
  entities: [`${import.meta.dirname}/**/*.entity.{ts,js}`],
  migrations: [`${import.meta.dirname}/**/migrations/*.{ts,js}`],
  synchronize: false,
  migrationsRun: true,
};

export default new DataSource(dataSourceOption);
