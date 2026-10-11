/**
 * CLI for the photo filename migration. See `USAGE` below and
 * `photo-migration.ts` for the safety rules.
 *
 *   pnpm migrate:photos [--run --yes-i-have-a-backup | --verify | --cleanup | --rollback <log>]
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions';
import { BillPhoto } from '../bill/entities/bill_photo.entity';
import { uploadsDir } from '../bill/photo-files';
import { TypeOrmConfigService } from '../shared/typeorm.service';
import {
  MigrationRunError,
  PhotoStore,
  Summary,
  cleanup,
  planMigration,
  planTotals,
  rollback,
  runMigration,
  verify,
} from './photo-migration';

export const USAGE = `Usage: pnpm migrate:photos [mode] [options]

Gives every bill photo its own file with a random name by COPYING it.
Original files are only ever removed by --cleanup --yes-i-have-a-backup.

Modes:
  (no flags)                       Dry run: print every planned change and totals.
                                   Changes nothing.
  --run --yes-i-have-a-backup      Copy each photo to <uuid>.<ext>, point its row
                                   at the copy, and log it to
                                   <uploads>/.migration/photos-<timestamp>.jsonl.
  --verify [--log <file>...]       Check that every row's file exists, is not
                                   empty and matches the logged size; list files
                                   no row references. Exits 1 on any problem.
  --cleanup [--log <file>...]      Dry run: list the old files cleanup would delete.
  --cleanup --yes-i-have-a-backup [--log <file>...]
                                   Delete old files listed in the logs that no row
                                   references, only if --verify passes.
  --rollback <log file>            Point rows back to their old files where the row
                                   still has the new path and the old file still
                                   exists. Never deletes files.
  --help                           Show this help.

Without --log, --verify and --cleanup read every .jsonl file in
<uploads>/.migration/.

Uploads dir: $UPLOADS_DIR, or ./uploads.
Database: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD (from the environment
or .env), the same settings the app uses.`;

type Mode = 'plan' | 'run' | 'verify' | 'cleanup' | 'rollback' | 'help';
type Args = { mode: Mode; yes: boolean; logs: string[]; rollbackLog?: string };

class UsageError extends Error {}

export function parseArgs(argv: string[]): Args {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const modes: Mode[] = [];
  let yes = false;
  const logs: string[] = [];
  let rollbackLog: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--run':
        modes.push('run');
        break;
      case '--verify':
        modes.push('verify');
        break;
      case '--cleanup':
        modes.push('cleanup');
        break;
      case '--help':
      case '-h':
        modes.push('help');
        break;
      case '--yes-i-have-a-backup':
        yes = true;
        break;
      case '--rollback':
        modes.push('rollback');
        rollbackLog = args[++i];
        if (!rollbackLog || rollbackLog.startsWith('--')) {
          throw new UsageError('--rollback needs a log file.');
        }
        break;
      case '--log':
        while (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) {
          logs.push(args[++i]);
        }
        if (logs.length === 0) throw new UsageError('--log needs a file.');
        break;
      default:
        throw new UsageError(`Unknown argument: ${a}`);
    }
  }

  if (modes.length > 1) throw new UsageError('Choose one mode only.');
  const mode = modes[0] ?? 'plan';
  if (logs.length && mode !== 'verify' && mode !== 'cleanup') {
    throw new UsageError('--log only goes with --verify or --cleanup.');
  }
  if (yes && mode !== 'run' && mode !== 'cleanup') {
    throw new UsageError(
      '--yes-i-have-a-backup only goes with --run or --cleanup.',
    );
  }
  return { mode, yes, logs, rollbackLog };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const shellQuote = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;

/**
 * The backup commands. The uploads copy is taken from the dir's real path
 * (symlinks resolved) into a sibling of that real dir, so a symlinked
 * uploads dir is backed up by content and the backup never lands inside the
 * symlinked tree.
 */
export async function backupInstructions(root: string): Promise<string> {
  const env = process.env;
  const date = today();
  let real = resolve(root);
  let warning = '';
  try {
    real = await realpath(root);
    if ((await lstat(root)).isSymbolicLink()) {
      warning = `\nWarning: ${root} is a symbolic link to ${real}. The backup below copies the real directory.\n`;
    }
  } catch {
    // Missing dir: fall back to the resolved path.
  }
  const backup = join(dirname(real), `${basename(real)}-backup-${date}`);
  return `Back up first, then rerun with --yes-i-have-a-backup:
${warning}
  mysqldump -h ${env.DB_HOST || '<host>'} -P ${env.DB_PORT || '<port>'} -u ${
    env.DB_USER || '<user>'
  } -p ${env.DB_NAME || '<database>'} > piggy-flow-${date}.sql
  mkdir -p ${shellQuote(backup)} && cp -a ${shellQuote(
    `${real}/.`,
  )} ${shellQuote(`${backup}/`)}

Check free disk space first: the run adds a copy of every photo, and the
backup adds another copy of the uploads dir.`;
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [TypeOrmConfigService],
})
class MigrationConfigModule {}

/**
 * Loads .env (via ConfigModule, as the app does) and returns the app's own
 * TypeORM settings from TypeOrmConfigService. Opens no DB connection.
 */
async function loadDbOptions(): Promise<MysqlConnectionOptions> {
  const ctx = await NestFactory.createApplicationContext(
    MigrationConfigModule,
    { logger: ['error', 'warn'] },
  );
  try {
    return ctx
      .get(TypeOrmConfigService)
      .createTypeOrmOptions() as MysqlConnectionOptions;
  } finally {
    await ctx.close();
  }
}

/** Same DB settings as the app, never synchronizing or migrating. */
async function createDataSource(
  options: MysqlConnectionOptions,
): Promise<DataSource> {
  const ds = new DataSource({
    ...options,
    // BillPhoto's relation to Bill (and Bill's to the rest) means TypeORM
    // needs every entity class to build BillPhoto's metadata; only BillPhoto
    // is ever queried.
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    migrations: [],
    migrationsRun: false,
    dropSchema: false,
    synchronize: false,
  });
  return ds.initialize();
}

function photoStore(ds: DataSource): PhotoStore {
  const repo = ds.getRepository(BillPhoto);
  return {
    async list() {
      const rows = await repo.find({
        select: { id: true, path: true },
        order: { id: 'ASC' },
      });
      return rows.map((r) => ({ id: r.id, path: r.path }));
    },
    async setPath(id, expectedOldPath, newPath) {
      // UPDATE bill_photo SET path = ? WHERE id = ? AND path = ?
      const res = await repo
        .createQueryBuilder()
        .update(BillPhoto)
        .set({ path: newPath })
        .where('id = :id AND path = :expectedOldPath', { id, expectedOldPath })
        .execute();
      return res.affected === 1;
    },
  };
}

async function defaultLogs(root: string): Promise<string[]> {
  const dir = join(root, '.migration');
  try {
    return (await readdir(dir))
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

const list = (title: string, items: string[]) => {
  if (items.length === 0) return;
  console.log(`\n${title} (${items.length}):`);
  for (const i of items) console.log(`  ${i}`);
};

function printRunSummary(s: Summary): void {
  console.log(`\nMigrated ${s.migrated} row(s).`);
  console.log(`Already migrated: ${s.alreadyRandom}.`);
  list(
    'Missing files, rows left unchanged',
    s.missing.map((m) => `row ${m.rowId}: ${m.oldPath}`),
  );
  list(
    'Invalid paths, rows left unchanged',
    s.invalid.map((m) => `row ${m.rowId}: ${JSON.stringify(m.oldPath)}`),
  );
  list(
    'Rows changed during the run, skipped (rerun to retry)',
    s.skipped.map((m) => `row ${m.rowId}: ${m.oldPath}`),
  );
  list(
    'Orphan copies left in uploads (check the row; delete by hand only if unreferenced)',
    s.orphanCopies,
  );
  console.log(
    s.migrated > 0
      ? `\nLog: ${s.logFile}`
      : '\nNo log written (nothing migrated).',
  );
}

async function main(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`${e.message}\n\n${USAGE}`);
    return 2;
  }
  if (args.mode === 'help') {
    console.log(USAGE);
    return 0;
  }

  const dbOptions = await loadDbOptions(); // also loads .env
  const root = uploadsDir();
  if (args.mode === 'run' && !args.yes) {
    console.error(
      `Refusing to run without --yes-i-have-a-backup.\n\n${await backupInstructions(
        root,
      )}`,
    );
    return 1;
  }
  if (!(await dirExists(root))) {
    console.error(`Uploads dir ${root} does not exist (cwd ${process.cwd()}).`);
    if (args.mode !== 'plan') return 1;
  }

  const ds = await createDataSource(dbOptions);
  try {
    const store = photoStore(ds);
    console.log(`Uploads dir: ${root}`);

    switch (args.mode) {
      case 'plan': {
        const plan = await planMigration(store, root);
        console.log('\nDry run. Nothing will be changed.\n');
        for (const p of plan) {
          const flags = p.shared ? ' [shared]' : '';
          if (p.status === 'migrate') {
            console.log(
              `  row ${p.rowId}: ${p.oldPath} -> ${p.newPath}${flags}`,
            );
          } else if (p.status !== 'already-random') {
            console.log(`  row ${p.rowId}: ${p.oldPath} [${p.status}]${flags}`);
          }
        }
        const t = planTotals(plan);
        console.log(`
Totals:
  rows:              ${t.rows}
  distinct files:    ${t.distinctFiles}
  shared files:      ${t.sharedFiles}
  to migrate:        ${t.toMigrate}
  already migrated:  ${t.alreadyMigrated}
  missing files:     ${t.missingFiles}
  invalid paths:     ${t.invalidPaths}

(New names are generated again on --run.)

${await backupInstructions(root)}`);
        return 0;
      }

      case 'run': {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logFile = join(root, '.migration', `photos-${stamp}.jsonl`);
        let s: Summary;
        let failure: string | null = null;
        try {
          s = await runMigration(store, root, logFile);
        } catch (e) {
          if (!(e instanceof MigrationRunError)) throw e;
          s = e.summary;
          failure = e.message;
        }
        printRunSummary(s);
        if (failure) {
          console.error(`\nRun STOPPED: ${failure}`);
          console.error(
            'Nothing was deleted. Fix the cause, then rerun the same command; migrated rows are skipped.',
          );
          return 1;
        }
        const incomplete =
          s.skipped.length + s.missing.length + s.invalid.length;
        if (incomplete > 0) {
          console.error(
            `\n${incomplete} row(s) were not migrated (listed above).`,
          );
          return 1;
        }
        console.log('\nNext: pnpm migrate:photos --verify');
        return 0;
      }

      case 'verify': {
        const logs = args.logs.length ? args.logs : await defaultLogs(root);
        console.log(`Logs: ${logs.length ? logs.join(', ') : '(none)'}`);
        const v = await verify(store, root, logs);
        list('Problems', v.problems);
        list('Missing before the migration', v.missingBeforeMigration);
        list('Not migrated yet (rerun --run)', v.unmigrated);
        list('Files no row references', v.unreferencedFiles);
        console.log(v.ok ? '\nVerify: OK' : '\nVerify: FAILED');
        return v.ok ? 0 : 1;
      }

      case 'cleanup': {
        const logs = args.logs.length ? args.logs : await defaultLogs(root);
        if (logs.length === 0) {
          console.log('No migration logs found. Nothing to clean up.');
          return 0;
        }
        console.log(`Logs: ${logs.join(', ')}`);
        const dryRun = !args.yes;
        const r = await cleanup(store, root, logs, { dryRun });
        if (r.refused) {
          list('Verify failed, nothing deleted', r.reasons);
          return 1;
        }
        list(
          'Kept',
          r.kept.map((k) => `${k.path} (${k.reason})`),
        );
        if (dryRun) {
          list('Would delete', r.wouldDelete);
          console.log(
            `\nDry run: nothing deleted. Rerun with --yes-i-have-a-backup to delete ${r.wouldDelete.length} file(s).`,
          );
          return 0;
        }
        list('Deleted', r.deleted);
        list(
          'Failed to delete',
          r.failed.map((f) => `${f.path}: ${f.error}`),
        );
        return r.failed.length ? 1 : 0;
      }

      case 'rollback': {
        if (!(await stat(args.rollbackLog!).catch(() => null))?.isFile()) {
          console.error(`Log file ${args.rollbackLog} not found.`);
          return 1;
        }
        const r = await rollback(store, root, args.rollbackLog!);
        list('Details', r.details);
        console.log(`\nRestored ${r.restored}, skipped ${r.skipped}.`);
        return 0;
      }
    }
    return 2;
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.stack ?? e.message : e);
      process.exit(1);
    },
  );
}
