# Database migrations

Schema changes are explicit TypeORM migrations in `src/migrations`. `synchronize` is off and
`migrationsRun` is unset, so the app never changes the schema on start. Migrations are run by hand.

## Locally

Set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` and `DB_PASSWORD` (or put them in `.env`; `src/data-source.ts` loads it).

```bash
pnpm migration:generate src/migrations/<Name>   # diff entities against the database
pnpm migration:run
pnpm migration:revert                           # undo the last migration
```

A throwaway database for generating and testing (MariaDB 10.3, same as production):

```bash
docker run -d --name pf-mig -e MARIADB_ROOT_PASSWORD=pf -e MARIADB_DATABASE=pf -p 3307:3306 mariadb:10.3 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
```

Generate against a database that is already at the latest migration, so the diff contains only your change.

`src/data-source.ts` uses the `mariadb` driver type on purpose. With `mysql`, TypeORM reads MariaDB's
`DEFAULT NULL` as a drift on every nullable column and generates phantom `ALTER`s.

## Docker (production)

```bash
docker exec piggy_flow_api node node_modules/typeorm/cli.js migration:run -d dist/data-source.js
```

## Baseline and the empty-diff check

The baseline migration creates the schema that `synchronize` used to build. It skips itself when the
`user` table exists, so on production it only records itself as run.

Before the first deploy, a human must check this against a production dump:

1. Load the dump into a fresh throwaway MariaDB 10.3 (`docker exec -i pf-mig mysql -uroot -ppf pf < dump.sql`).
2. Run `pnpm migration:run`. The baseline must skip itself (no `CREATE TABLE`).
3. Run `pnpm migration:generate src/migrations/ShouldBeEmpty`. Expected: `No changes in database schema were found`.
   If a file is written, delete it and investigate the drift before deploying.

## Rules

Never edit a migration that has run in production. Write a new one instead.

`migration:revert` stops at the baseline: its `down()` throws, because reverting it would drop every table.
