/**
 * One-off migration of bill photo files to random (v4 UUID) names.
 *
 * Safety model (see the spec's "Migration of existing photos"):
 * - Originals are never renamed, overwritten or deleted by `runMigration`.
 *   Each row gets its own fresh copy; only the copy can ever be removed, and
 *   only when the row could not be pointed at it.
 * - `cleanup` is the only function that deletes originals, and only those
 *   listed as `oldPath` in a migration log, unreferenced by every row, plain
 *   filenames inside root, and only while `verify` passes.
 * - `rollback` only rewrites DB rows; it never deletes files.
 *
 * Everything works on an injected `PhotoStore` and an uploads `root`, so it
 * can be tested without MySQL.
 */
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  unlink,
} from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { isRandomPhotoName, photoExtension } from '../bill/photo-files';

export type PhotoRow = { id: number; path: string };

export interface PhotoStore {
  list(): Promise<PhotoRow[]>;
  /** Conditional update; false if the row's path changed meanwhile. */
  setPath(
    id: number,
    expectedOldPath: string,
    newPath: string,
  ): Promise<boolean>;
}

export type PlanStatus =
  | 'migrate'
  | 'already-random'
  | 'missing-file'
  | 'invalid-path';

export type PlanItem = {
  rowId: number;
  oldPath: string;
  newPath: string | null;
  status: PlanStatus;
  shared: boolean;
};

export type PlanTotals = {
  rows: number;
  distinctFiles: number;
  sharedFiles: number;
  toMigrate: number;
  alreadyMigrated: number;
  missingFiles: number;
  invalidPaths: number;
};

export type LogEntry = {
  rowId: number;
  oldPath: string;
  newPath: string;
  size: number;
};

export type Summary = {
  migrated: number;
  alreadyRandom: number;
  missing: PlanItem[];
  invalid: PlanItem[];
  /** Rows whose path changed between planning and update; their copy was removed. */
  skipped: PlanItem[];
  logFile: string;
};

export type VerifyResult = {
  ok: boolean;
  problems: string[];
  /** Rows with a never-migrated (non-random) path whose file is missing. */
  missingBeforeMigration: string[];
  unreferencedFiles: string[];
};

export type CleanupResult = {
  refused: boolean;
  /** Verify problems when refused. */
  reasons: string[];
  deleted: string[];
  /** Dry run only: what a real run would delete. */
  wouldDelete: string[];
  kept: { path: string; reason: string }[];
  failed: { path: string; error: string }[];
};

export type RollbackResult = {
  restored: number;
  skipped: number;
  details: string[];
};

export type RunOptions = {
  /** Test seam. Must fail if `dst` exists. Defaults to copyFile(COPYFILE_EXCL). */
  copy?: (src: string, dst: string) => Promise<void>;
};

/**
 * True only for a single plain filename: no directory parts, no backslash,
 * not '', '.' or '..'.
 */
export function isPlainFilename(p: string): boolean {
  return (
    typeof p === 'string' &&
    p !== '' &&
    p !== '.' &&
    p !== '..' &&
    !p.includes('/') &&
    !p.includes('\\') &&
    !p.includes('\0')
  );
}

/** Absolute path of a plain filename inside root, or null if unsafe. */
function insideRoot(root: string, p: string): string | null {
  if (!isPlainFilename(p)) return null;
  const rootAbs = resolve(root);
  const target = resolve(rootAbs, p);
  const rel = relative(rootAbs, target);
  if (
    rel === '' ||
    rel === '..' ||
    rel.startsWith('../') ||
    rel.startsWith('..\\') ||
    isAbsolute(rel) ||
    rel !== p
  ) {
    return null;
  }
  return target;
}

async function regularFileSize(abs: string): Promise<number | null> {
  try {
    const s = await stat(abs);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

/**
 * A fresh random name keeping the original's extension, lowercased. Uses the
 * same `<uuid v4>.<ext>` scheme as new uploads. An extension that isn't a
 * short alphanumeric one is dropped rather than copied into the name.
 */
export function migratedName(oldPath: string): string {
  const allowed = photoExtension(oldPath);
  const ext = allowed ?? extname(oldPath).slice(1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? `${randomUUID()}.${ext}` : randomUUID();
}

/** Reads the plan. Never writes anything. */
export async function planMigration(
  store: PhotoStore,
  root: string,
): Promise<PlanItem[]> {
  const rows = [...(await store.list())].sort((a, b) => a.id - b.id);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.path, (counts.get(r.path) ?? 0) + 1);

  const items: PlanItem[] = [];
  for (const row of rows) {
    const base = {
      rowId: row.id,
      oldPath: row.path,
      newPath: null,
      shared: (counts.get(row.path) ?? 0) > 1,
    };
    const abs = insideRoot(root, row.path);
    if (!abs) {
      items.push({ ...base, status: 'invalid-path' });
    } else if (isRandomPhotoName(row.path)) {
      items.push({ ...base, status: 'already-random' });
    } else if ((await regularFileSize(abs)) === null) {
      items.push({ ...base, status: 'missing-file' });
    } else {
      items.push({
        ...base,
        status: 'migrate',
        newPath: migratedName(row.path),
      });
    }
  }
  return items;
}

export function planTotals(plan: PlanItem[]): PlanTotals {
  const files = new Map<string, number>();
  for (const p of plan) files.set(p.oldPath, (files.get(p.oldPath) ?? 0) + 1);
  const count = (s: PlanStatus) => plan.filter((p) => p.status === s).length;
  return {
    rows: plan.length,
    distinctFiles: files.size,
    sharedFiles: [...files.values()].filter((n) => n > 1).length,
    toMigrate: count('migrate'),
    alreadyMigrated: count('already-random'),
    missingFiles: count('missing-file'),
    invalidPaths: count('invalid-path'),
  };
}

const defaultCopy = (src: string, dst: string) =>
  copyFile(src, dst, constants.COPYFILE_EXCL);

async function fsyncFile(abs: string): Promise<void> {
  const h = await open(abs, 'r');
  try {
    await h.sync();
  } finally {
    await h.close();
  }
}

/** Removes a copy this run created. Never called for originals. */
async function removeOwnCopy(abs: string): Promise<void> {
  try {
    await unlink(abs);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn(
        `Could not remove copy ${abs}: ${(e as Error)?.message ?? e}`,
      );
    }
  }
}

/**
 * Migrates every `migrate` row, one at a time:
 * copy (exclusive) → compare sizes → fsync copy → conditional DB update →
 * append + fsync a log line. Never unlinks an original.
 */
export async function runMigration(
  store: PhotoStore,
  root: string,
  logFile: string,
  opts: RunOptions = {},
): Promise<Summary> {
  const copy = opts.copy ?? defaultCopy;
  const plan = await planMigration(store, root);
  const summary: Summary = {
    migrated: 0,
    alreadyRandom: plan.filter((p) => p.status === 'already-random').length,
    missing: plan.filter((p) => p.status === 'missing-file'),
    invalid: plan.filter((p) => p.status === 'invalid-path'),
    skipped: [],
    logFile,
  };

  let log: FileHandle | null = null;
  try {
    for (const item of plan) {
      if (item.status !== 'migrate') continue;
      const src = insideRoot(root, item.oldPath);
      const dst = insideRoot(root, item.newPath!);
      if (!src || !dst) throw new Error(`Unsafe path for row ${item.rowId}`);

      // 1. Copy, never overwriting. On EEXIST the file isn't ours: leave it.
      try {
        await copy(src, dst);
      } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code !== 'EEXIST') {
          await removeOwnCopy(dst);
        }
        throw e;
      }

      // 2. Sizes must match.
      const [srcSize, dstSize] = await Promise.all([
        regularFileSize(src),
        regularFileSize(dst),
      ]);
      if (srcSize === null || dstSize === null || srcSize !== dstSize) {
        await removeOwnCopy(dst);
        throw new Error(
          `Size mismatch copying row ${item.rowId} (${item.oldPath}: ${srcSize}, copy: ${dstSize}); stopped.`,
        );
      }
      await fsyncFile(dst);

      // 3. Point that row (only) at the copy.
      let updated: boolean;
      try {
        updated = await store.setPath(item.rowId, item.oldPath, item.newPath!);
      } catch (e) {
        await removeOwnCopy(dst);
        throw e;
      }
      if (!updated) {
        await removeOwnCopy(dst);
        summary.skipped.push(item);
        continue;
      }

      // 4. Log and flush.
      if (!log) {
        await mkdir(dirname(logFile), { recursive: true });
        log = await open(logFile, 'a');
      }
      const entry: LogEntry = {
        rowId: item.rowId,
        oldPath: item.oldPath,
        newPath: item.newPath!,
        size: dstSize,
      };
      await log.write(JSON.stringify(entry) + '\n');
      await log.sync();
      summary.migrated++;
    }
  } finally {
    if (log) await log.close();
  }
  return summary;
}

function isLogEntry(v: unknown): v is LogEntry {
  const e = v as LogEntry;
  return (
    !!e &&
    typeof e === 'object' &&
    Number.isInteger(e.rowId) &&
    typeof e.oldPath === 'string' &&
    typeof e.newPath === 'string' &&
    Number.isInteger(e.size) &&
    e.size >= 0
  );
}

/** Parses log files. Unreadable files and malformed lines become problems. */
export async function readLogs(
  logFiles: string[],
): Promise<{ entries: LogEntry[]; problems: string[] }> {
  const entries: LogEntry[] = [];
  const problems: string[] = [];
  for (const file of logFiles) {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (e) {
      problems.push(`Cannot read log ${file}: ${(e as Error)?.message ?? e}`);
      continue;
    }
    text.split('\n').forEach((line, i) => {
      if (line.trim() === '') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        parsed = undefined;
      }
      if (isLogEntry(parsed)) entries.push(parsed);
      else problems.push(`Malformed line ${i + 1} in log ${file}`);
    });
  }
  return { entries, problems };
}

/**
 * Checks every DB row against the files on disk, independent of how the
 * row got its path. A row migrated without a log line (crash between update
 * and log) is healthy as long as its file exists.
 */
export async function verify(
  store: PhotoStore,
  root: string,
  logFiles: string[],
): Promise<VerifyResult> {
  const { entries, problems } = await readLogs(logFiles);
  const missingBeforeMigration: string[] = [];
  const byNewPath = new Map<string, LogEntry>();
  for (const e of entries) byNewPath.set(e.newPath, e);

  const rows = [...(await store.list())].sort((a, b) => a.id - b.id);
  for (const row of rows) {
    const abs = insideRoot(root, row.path);
    if (!abs) {
      problems.push(`row ${row.id}: invalid path ${JSON.stringify(row.path)}`);
      continue;
    }
    const size = await regularFileSize(abs);
    const logged = byNewPath.get(row.path);
    if (size === null) {
      if (!isRandomPhotoName(row.path) && !logged) {
        missingBeforeMigration.push(
          `row ${row.id}: ${row.path} is missing (never migrated; it was missing before the migration or removed outside it)`,
        );
      } else {
        problems.push(`row ${row.id}: file ${row.path} is missing`);
      }
      continue;
    }
    if (size === 0) {
      problems.push(`row ${row.id}: file ${row.path} is empty`);
    }
    if (logged) {
      if (logged.rowId !== row.id) {
        problems.push(
          `row ${row.id}: path ${row.path} was logged for row ${logged.rowId}`,
        );
      }
      if (logged.size !== size) {
        problems.push(
          `row ${row.id}: size of ${row.path} is ${size}, log says ${logged.size}`,
        );
      }
    }
  }

  const referenced = new Set(rows.map((r) => r.path));
  const unreferencedFiles: string[] = [];
  try {
    for (const e of await readdir(root, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (!e.isFile()) continue;
      if (!referenced.has(e.name)) unreferencedFiles.push(e.name);
    }
  } catch (e) {
    problems.push(
      `Cannot list uploads dir ${root}: ${(e as Error)?.message ?? e}`,
    );
  }
  unreferencedFiles.sort();

  return {
    ok: problems.length === 0 && missingBeforeMigration.length === 0,
    problems,
    missingBeforeMigration,
    unreferencedFiles,
  };
}

/**
 * Deletes logged `oldPath` files, only when verify passes, no row references
 * them (compared case-insensitively, to be safe on case-insensitive
 * filesystems), and they are plain, non-dot filenames inside root.
 */
export async function cleanup(
  store: PhotoStore,
  root: string,
  logFiles: string[],
  opts: { dryRun: boolean },
): Promise<CleanupResult> {
  const result: CleanupResult = {
    refused: false,
    reasons: [],
    deleted: [],
    wouldDelete: [],
    kept: [],
    failed: [],
  };

  const check = await verify(store, root, logFiles);
  if (!check.ok) {
    result.refused = true;
    result.reasons = [...check.problems, ...check.missingBeforeMigration];
    return result;
  }

  const { entries } = await readLogs(logFiles);
  const candidates = [...new Set(entries.map((e) => e.oldPath))];
  // Fresh read right before deciding, after verify.
  const rows = await store.list();
  const referenced = new Set(rows.map((r) => r.path.toLowerCase()));

  for (const p of candidates) {
    const keep = (reason: string) => result.kept.push({ path: p, reason });
    const abs = insideRoot(root, p);
    if (!abs) {
      keep('not a plain filename inside uploads');
      continue;
    }
    if (p.startsWith('.')) {
      keep('dotfiles are never deleted');
      continue;
    }
    if (referenced.has(p.toLowerCase())) {
      keep('still referenced by a row');
      continue;
    }
    let isFile = false;
    try {
      isFile = (await lstat(abs)).isFile();
    } catch {
      keep('already gone');
      continue;
    }
    if (!isFile) {
      keep('not a regular file');
      continue;
    }
    if (opts.dryRun) {
      result.wouldDelete.push(p);
      continue;
    }
    try {
      await unlink(abs);
      result.deleted.push(p);
    } catch (e) {
      result.failed.push({
        path: p,
        error: (e as Error)?.message ?? String(e),
      });
    }
  }
  return result;
}

/**
 * Points rows back at `oldPath`, newest log line first, only where the row
 * still has `newPath` and the old file still exists. Never deletes files.
 */
export async function rollback(
  store: PhotoStore,
  root: string,
  logFile: string,
): Promise<RollbackResult> {
  const { entries, problems } = await readLogs([logFile]);
  const result: RollbackResult = {
    restored: 0,
    skipped: problems.length,
    details: [...problems],
  };
  const rows = new Map((await store.list()).map((r) => [r.id, r.path]));

  for (const e of [...entries].reverse()) {
    const skip = (why: string) => {
      result.skipped++;
      result.details.push(`row ${e.rowId}: skipped, ${why}`);
    };
    if (rows.get(e.rowId) !== e.newPath) {
      skip(`its path is no longer ${e.newPath}`);
      continue;
    }
    const oldAbs = insideRoot(root, e.oldPath);
    if (!oldAbs || (await regularFileSize(oldAbs)) === null) {
      skip(`old file ${e.oldPath} is not in uploads any more`);
      continue;
    }
    if (await store.setPath(e.rowId, e.newPath, e.oldPath)) {
      rows.set(e.rowId, e.oldPath);
      result.restored++;
      result.details.push(`row ${e.rowId}: ${e.newPath} -> ${e.oldPath}`);
    } else {
      skip('it changed during rollback');
    }
  }
  return result;
}
