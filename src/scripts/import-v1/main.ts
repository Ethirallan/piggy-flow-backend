import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import dataSource from '../../database-source.js';
import { PhotoStorage } from '../../photos/photo-storage.js';
import { localToday } from '../../subscriptions/charge-schedule.js';
import {
  applyPlan,
  assertV2Empty,
  checkSources,
  loadV2Users,
} from './apply.js';
import { parseDump } from './parse-dump.js';
import { planImport } from './plan.js';
import { formatReport } from './report.js';
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
    throw new Error(USAGE);
  }
  const snapshot = toSnapshot(parseDump(await readFile(values.dump, 'utf8')));
  await dataSource.initialize(); // runs pending migrations (migrationsRun)
  try {
    await assertV2Empty(dataSource);
    const plan = planImport(snapshot, await loadV2Users(dataSource), {
      dismissedEmails: (values['dismiss-users'] ?? '')
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean),
      today: localToday(),
    });
    const sources = await checkSources(plan, values.uploads);
    if (!values.apply) {
      console.log(formatReport(plan, sources));
      return;
    }
    const storage = new PhotoStorage(
      resolve(process.env.UPLOADS_DIR || 'uploads'),
    );
    await storage.onModuleInit();
    const applied = await applyPlan(dataSource, plan, values.uploads, storage);
    console.log(formatReport(plan, { ...sources, applied }));
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
