import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import dataSource from '../../database-source.js';
import { PhotoStorage } from '../../photos/photo-storage.js';
import { localToday } from '../../subscriptions/charge-schedule.js';
import {
  applyPlan,
  assertV2Empty,
  checkFolders,
  checkSources,
  checkTarget,
  ImportError,
  loadV2Users,
  readDump,
} from './apply.js';
import { parseDump } from './parse-dump.js';
import { planImport } from './plan.js';
import { formatError, formatReport } from './report.js';
import { toSnapshot } from './v1-snapshot.js';

const USAGE =
  'Usage: pnpm import:v1 --dump <file.sql> --uploads <v1 uploads dir> [--dismiss-users a@x,b@y] [--apply]';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dump: { type: 'string' },
      uploads: { type: 'string' },
      'dismiss-users': { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
  });
  if (!values.dump || !values.uploads) {
    throw new ImportError(USAGE);
  }
  const snapshot = toSnapshot(parseDump(await readDump(values.dump)));
  const targetDir = resolve(process.env.UPLOADS_DIR || 'uploads');
  const { host, port, database } = dataSource.options as {
    host?: string;
    port?: number;
    database?: string;
  };
  const target = { host, port, database, uploads: targetDir };
  await dataSource.initialize(); // runs pending migrations (migrationsRun)
  try {
    await assertV2Empty(dataSource);
    await checkFolders(values.uploads, targetDir);
    await checkTarget(targetDir);
    const users = await loadV2Users(dataSource);
    const plan = planImport(snapshot, users, {
      dismissedEmails: (values['dismiss-users'] ?? '')
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean),
      today: localToday(),
    });
    const sources = await checkSources(plan, values.uploads);
    if (!values.apply) {
      console.log(formatReport(plan, { target, users, ...sources }));
      return;
    }
    // Not onModuleInit(): that clears the running app's in-progress uploads.
    const storage = new PhotoStorage(targetDir);
    const applied = await applyPlan(
      dataSource,
      plan,
      values.uploads,
      storage,
      (message) => process.stderr.write(`${message}\n`),
    );
    console.log(formatReport(plan, { target, users, ...sources, applied }));
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
