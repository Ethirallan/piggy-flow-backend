/**
 * CLI for the account-scoped lists data migration. See `USAGE` below and
 * `account-migration.ts` for the safety rules and the log format.
 *
 *   pnpm migrate:accounts [--run --yes-i-have-a-backup | --verify | --rollback <log>...]
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import {
  AccountsStore,
  accountLabel,
  DUPLICATE_PERSONAL_NAME,
  plannedDuplicates,
  planMigration,
  rollback,
  runMigration,
  undoTarget,
  verify,
} from './account-migration';

export const USAGE = `Usage: pnpm migrate:accounts [mode] [options]

Moves bills, subscriptions, shops and categories into accounts. Never deletes
a row.

Modes:
  (no flags)                     Dry run: print the plan summary. Changes nothing.
  --run --yes-i-have-a-backup    Apply the plan, logging every write to
                                 ./.migration/accounts-<timestamp>.jsonl.
  --verify [--log <file>...]     Check that every row has an account, that bills
                                 and subscriptions use shops and categories from
                                 their own account, that every user has exactly
                                 one Personal account and that per-user bill
                                 totals match the earliest log. Exits 1 on any
                                 problem.
  --rollback <log> [<log>...] --yes-i-have-a-backup
                                 Undo the logged writes, newest first, where the
                                 row still has the migrated value; list the rows
                                 skipped. Created Personal accounts and copies
                                 are kept.
  --help                         Show this help.

Without --log, --verify reads every ./.migration/accounts-*.jsonl.
Don't rename the log files: verify and rollback order them by name.

Database: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD (from the environment
or .env).`;

type Mode = 'plan' | 'run' | 'verify' | 'rollback' | 'help';
type Args = { mode: Mode; yes: boolean; logs: string[] };

class UsageError extends Error {}

export function parseArgs(argv: string[]): Args {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const modes: Mode[] = [];
  const logs: string[] = [];
  let yes = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--run':
        modes.push('run');
        break;
      case '--verify':
        modes.push('verify');
        break;
      case '--help':
      case '-h':
        modes.push('help');
        break;
      case '--yes-i-have-a-backup':
        yes = true;
        break;
      case '--log':
      case '--rollback': {
        const start = logs.length;
        while (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) {
          logs.push(args[++i]);
        }
        if (logs.length === start)
          throw new UsageError(`${a} needs a log file.`);
        if (a === '--rollback') modes.push('rollback');
        break;
      }
      default:
        throw new UsageError(`Unknown argument: ${a}`);
    }
  }
  if (modes.length > 1) throw new UsageError('Choose one mode only.');
  const mode = modes[0] ?? 'plan';
  if (args.includes('--log') && mode !== 'verify') {
    throw new UsageError('--log only goes with --verify.');
  }
  if (yes && mode !== 'run' && mode !== 'rollback') {
    throw new UsageError(
      '--yes-i-have-a-backup only goes with --run or --rollback.',
    );
  }
  return { mode, yes, logs };
}

/**
 * Raw parameterised SQL. Table and column names only come from the code.
 * Every UPDATE keeps `lastUpdate` (ON UPDATE CURRENT_TIMESTAMP on account,
 * bill, subscription, shop and category), so the migration and its rollback
 * leave last-edit times alone.
 */
export function sqlStore(ds: DataSource): AccountsStore {
  const update = async (sql: string, params: unknown[]) =>
    (await ds.query(sql, params)).affectedRows === 1;
  const listColumns = (t: string) =>
    t === 'shop'
      ? 'id, userId, accountId, name'
      : 'id, userId, accountId, name, emoji';
  return {
    users: () => ds.query('SELECT id FROM user'),
    personalAccounts: () =>
      ds.query(
        `SELECT a.id AS accountId, ua.userId, a.name FROM account a
         JOIN user_accounts_account ua ON ua.accountId = a.id WHERE a.personal = 1`,
      ),
    refs: (t) =>
      ds.query(
        `SELECT id, userId, accountId, shopId, categoryId, price FROM ${t}`,
      ),
    lists: (t) => ds.query(`SELECT ${listColumns(t)} FROM ${t}`),
    createPersonal: (userId) =>
      ds.transaction(async (m) => {
        const res = await m.query(
          "INSERT INTO account (name, personal) VALUES ('Personal', 1)",
        );
        await m.query(
          'INSERT INTO user_accounts_account (userId, accountId) VALUES (?, ?)',
          [userId, res.insertId],
        );
        return res.insertId;
      }),
    clearPersonal: (id, expectedName) =>
      update(
        'UPDATE account SET personal = 0, name = ?, lastUpdate = lastUpdate WHERE id = ? AND personal = 1 AND name <=> ?',
        [DUPLICATE_PERSONAL_NAME, id, expectedName],
      ),
    restorePersonal: (id, name) =>
      update(
        'UPDATE account SET personal = 1, name = ?, lastUpdate = lastUpdate WHERE id = ? AND personal = 0 AND name <=> ?',
        [name, id, DUPLICATE_PERSONAL_NAME],
      ),
    setRefAccount: (t, id, expected, accountId) =>
      update(
        `UPDATE ${t} SET accountId = ?, lastUpdate = lastUpdate WHERE id = ? AND accountId <=> ?`,
        [accountId, id, expected],
      ),
    setListAccount: (t, id, expected, accountId) =>
      update(
        `UPDATE ${t} SET accountId = ?, lastUpdate = lastUpdate WHERE id = ? AND accountId <=> ?`,
        [accountId, id, expected],
      ),
    insertListCopy: async (t, s, accountId) =>
      (t === 'shop'
        ? await ds.query(
            'INSERT INTO shop (name, userId, accountId) VALUES (?, ?, ?)',
            [s.name, s.userId, accountId],
          )
        : await ds.query(
            'INSERT INTO category (name, emoji, userId, accountId) VALUES (?, ?, ?, ?)',
            [s.name, s.emoji ?? null, s.userId, accountId],
          )
      ).insertId,
    repoint: (t, id, field, expected, newId) =>
      update(
        `UPDATE ${t} SET ${field} = ?, lastUpdate = lastUpdate WHERE id = ? AND ${field} <=> ?`,
        [newId, id, expected],
      ),
  };
}

function backupAdvice(): string {
  const env = process.env;
  const date = new Date().toISOString().slice(0, 10);
  return `Back up first, then rerun with --yes-i-have-a-backup:

  mysqldump -h ${env.DB_HOST || '<host>'} -P ${env.DB_PORT || '<port>'} -u ${
    env.DB_USER || '<user>'
  } -p ${env.DB_NAME || '<database>'} > piggy-flow-${date}.sql`;
}

async function defaultLogs(): Promise<string[]> {
  const dir = '.migration';
  const files = await readdir(dir).catch(() => [] as string[]);
  return files
    .filter((f) => f.startsWith('accounts-') && f.endsWith('.jsonl'))
    .map((f) => join(dir, f));
}

const list = (title: string, items: string[]) => {
  if (items.length === 0) return;
  console.log(`\n${title} (${items.length}):`);
  for (const i of items) console.log(`  ${i}`);
};

export async function main(argv: string[]): Promise<number> {
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
  // Importing data-source loads .env (when present), so the backup advice
  // shows the real settings. It only connects at initialize() below.
  const ds: DataSource = (await import('../data-source')).default;
  if ((args.mode === 'run' || args.mode === 'rollback') && !args.yes) {
    console.error(
      `Refusing to ${
        args.mode === 'run' ? 'run' : 'roll back'
      } without --yes-i-have-a-backup.\n\n${backupAdvice()}`,
    );
    return 1;
  }

  await ds.initialize();
  try {
    const store = sqlStore(ds);
    switch (args.mode) {
      case 'plan': {
        const actions = await planMigration(store);
        console.log('Dry run. Nothing will be changed.');
        const counts = new Map<string, number>();
        for (const a of actions)
          counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
        list(
          `Planned actions, ${actions.length} in all, by kind`,
          [...counts].map(([kind, n]) => `${kind}: ${n}`),
        );
        list(
          'Copies',
          actions.flatMap((a) =>
            a.kind === 'copy'
              ? [
                  `${a.table} ${a.sourceId} -> ${accountLabel(a.to)} (${
                    a.refs.length
                  } refs)`,
                ]
              : [],
          ),
        );
        list(
          'Skipped',
          actions.flatMap((a) =>
            a.kind === 'skip' ? [`${a.table} ${a.id}: ${a.reason}`] : [],
          ),
        );
        const lists = {
          shop: await store.lists('shop'),
          category: await store.lists('category'),
        };
        list(
          'Same-name duplicates in one account after the run',
          plannedDuplicates(lists, actions),
        );
        console.log(`\n${backupAdvice()}`);
        return 0;
      }
      case 'run': {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logFile = join('.migration', `accounts-${stamp}.jsonl`);
        const r = await runMigration(store, logFile);
        console.log(`Applied ${r.applied}. Log: ${logFile}`);
        list(
          'Skipped',
          r.skipped.map((a) => JSON.stringify(a)),
        );
        const failed = r.skipped.filter((a) => a.kind !== 'skip').length;
        if (failed) {
          console.error(
            `\n${failed} write(s) matched no row. Rerun --run to retry them.`,
          );
          return 1;
        }
        console.log('\nNext: pnpm migrate:accounts --verify');
        return 0;
      }
      case 'verify': {
        const logs = args.logs.length ? args.logs : await defaultLogs();
        console.log(`Logs: ${logs.length ? logs.join(', ') : '(none)'}`);
        const v = await verify(store, logs);
        list('Problems', v.problems);
        console.log(v.ok ? '\nVerify: OK' : '\nVerify: FAILED');
        return v.ok ? 0 : 1;
      }
      case 'rollback': {
        const r = await rollback(store, args.logs);
        const details: string[] = [];
        for (const a of r.skippedIntents) {
          const t = undoTarget(a);
          const [row] = await ds.query(
            `SELECT ${t.column} AS v FROM ${t.table} WHERE id = ?`,
            [t.id],
          );
          const now = row ? JSON.stringify(row.v) : 'row missing';
          details.push(
            `${t.table} ${t.id} ${t.column}: expected ${JSON.stringify(
              t.expected,
            )}, now ${now}`,
          );
        }
        list('Skipped (value no longer the migrated one)', details);
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
