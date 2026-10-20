import { constants } from 'node:fs';
import { access, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type {
  DataSource,
  EntityManager,
  ObjectLiteral,
  EntityTarget,
} from 'typeorm';
import { AccountMember } from '../../accounts/account-member.entity.js';
import { Account } from '../../accounts/account.entity.js';
import { Bill } from '../../bills/bill.entity.js';
import { Category } from '../../categories/category.entity.js';
import { BillPhoto } from '../../photos/bill-photo.entity.js';
import {
  assertConvertible,
  processPhoto,
  type ProcessedPhoto,
} from '../../photos/photo-processing.js';
import type { PhotoStorage } from '../../photos/photo-storage.js';
import { Shop } from '../../shops/shop.entity.js';
import { Subscription } from '../../subscriptions/subscription.entity.js';
import type { Plan, Totals, V2User } from './plan.js';

export class ImportError extends Error {}

export interface ApplyResult {
  photos: number;
  bytesBefore: number;
  bytesAfter: number;
}

const BATCH = 500;
/** pg_advisory_xact_lock key: one import transaction at a time. */
export const IMPORT_LOCK = 0x7069_6731; // "pig1"

/** Refuses a v2 database that already holds imported (or user-entered) data. */
export async function assertV2Empty(
  db: DataSource | EntityManager,
): Promise<void> {
  const [counts]: Record<string, number>[] = await db.query(`
    SELECT (SELECT count(*) FROM shops)::int AS shops,
           (SELECT count(*) FROM categories)::int AS categories,
           (SELECT count(*) FROM bills)::int AS bills,
           (SELECT count(*) FROM bill_photos)::int AS photos,
           (SELECT count(*) FROM subscriptions)::int AS subscriptions,
           (SELECT count(*) FROM accounts WHERE NOT is_personal)::int AS accounts`);
  const found = Object.entries(counts).filter(([, n]) => n > 0);
  if (found.length > 0) {
    throw new ImportError(
      `The v2 database already has data (${found.map(([k, n]) => `${n} ${k}`).join(', ')}); the import only runs on a fresh one.`,
    );
  }
}

/** Registered v2 users with their Personal account. */
export async function loadV2Users(db: DataSource): Promise<V2User[]> {
  const rows: { id: string; email: string; personal: string }[] =
    await db.query(`
    SELECT u.id, u.email, a.id AS personal
    FROM users u
    JOIN account_members m ON m.user_id = u.id
    JOIN accounts a ON a.id = m.account_id AND a.is_personal`);
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    personalAccountId: r.personal,
  }));
}

/**
 * Every planned photo's file exists and has a header processPhoto accepts;
 * returns the folder's files no row uses.
 */
export async function checkSources(
  plan: Plan,
  sourceDir: string,
): Promise<{ unreferenced: string[] }> {
  const missing: string[] = [];
  const unsupported: string[] = [];
  for (const photo of plan.photos) {
    const path = join(sourceDir, photo.source);
    try {
      if (!(await stat(path)).isFile()) {
        missing.push(photo.source);
        continue;
      }
    } catch {
      missing.push(photo.source);
      continue;
    }
    try {
      assertConvertible(await sharp(path).metadata());
    } catch (error) {
      unsupported.push(`${photo.source} (${messageOf(error)})`);
    }
  }
  const problems = [
    missing.length > 0 &&
      `Photo files missing in ${sourceDir}: ${missing.join(', ')}`,
    unsupported.length > 0 &&
      `Photo files that can't be converted in ${sourceDir}: ${unsupported.join(', ')}`,
  ].filter((p) => typeof p === 'string');
  if (problems.length > 0) {
    throw new ImportError(problems.join('\n'));
  }
  const used = new Set(plan.photos.map((p) => p.source));
  const files = await readdir(sourceDir);
  return {
    unreferenced: files
      .filter((f) => !used.has(f) && !f.startsWith('.'))
      .sort(),
  };
}

/**
 * Creates the v2 uploads folder if needed and checks it is writable. It must
 * hold no photo files: v2 has no photo rows yet, so any are left over from an
 * interrupted run (or belong to another database).
 */
export async function checkTarget(targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  try {
    await access(targetDir, constants.W_OK);
  } catch {
    throw new ImportError(`The uploads folder ${targetDir} is not writable.`);
  }
  const photos = (await readdir(targetDir)).filter((f) =>
    /\.jpg(\.tmp)?$/.test(f),
  );
  if (photos.length > 0) {
    throw new ImportError(
      `${photos.length} photo files are already in ${targetDir}, but v2 has no photos; ` +
        `they are left over from an earlier run. Remove them (*.jpg, *.jpg.tmp) and run again.`,
    );
  }
}

/**
 * Converts the photos, then writes every row in one transaction and checks
 * the totals against v1 before committing. On any failure nothing stays: the
 * transaction rolls back and the photo files written here are deleted.
 */
export async function applyPlan(
  dataSource: DataSource,
  plan: Plan,
  sourceDir: string,
  storage: PhotoStorage,
): Promise<ApplyResult> {
  await assertV2Empty(dataSource);
  await checkTarget(storage.dir);
  const written: string[] = [];
  const result: ApplyResult = { photos: 0, bytesBefore: 0, bytesAfter: 0 };
  try {
    const photoRows: Partial<BillPhoto>[] = [];
    for (const photo of plan.photos) {
      const input = await readFile(join(sourceDir, photo.source));
      let processed: ProcessedPhoto;
      try {
        processed = await processPhoto(input);
      } catch (error) {
        throw new ImportError(
          `photo ${photo.source} can't be converted: ${messageOf(error)}`,
        );
      }
      written.push(photo.id); // before the write: a failed write may leave a file
      await storage.write(photo.id, processed.jpeg);
      result.photos++;
      result.bytesBefore += input.length;
      result.bytesAfter += processed.jpeg.length;
      photoRows.push({
        id: photo.id,
        billId: photo.billId,
        name: photo.name,
        width: processed.width,
        height: processed.height,
        sizeBytes: processed.jpeg.length,
        createdById: photo.createdById,
        createdAt: photo.createdAt,
      });
    }

    await dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [IMPORT_LOCK]);
      await manager.query('SET LOCAL statement_timeout = 0');
      await assertV2Empty(manager); // another run may have committed meanwhile
      await insert(manager, Account, plan.accounts);
      await insert(manager, AccountMember, plan.members);
      await insert(manager, Shop, plan.shops);
      await insert(manager, Category, plan.categories);
      await insert(manager, Subscription, plan.subscriptions);
      await insert(manager, Bill, plan.bills);
      await insert(manager, BillPhoto, photoRows);
      await verifyTotals(manager, plan);
    });
    return result;
  } catch (error) {
    for (const id of written) {
      try {
        await storage.delete(id);
      } catch {
        // Best effort: the original error matters more; checkTarget reports leftovers.
      }
    }
    throw error;
  }
}

async function insert<T extends ObjectLiteral>(
  manager: EntityManager,
  entity: EntityTarget<T>,
  rows: object[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    await manager
      .createQueryBuilder()
      .insert()
      .into(entity)
      .values(rows.slice(i, i + BATCH) as T[])
      .execute();
  }
}

/** Bill count and price sum per account and per user must equal v1's. */
async function verifyTotals(manager: EntityManager, plan: Plan): Promise<void> {
  const read = async (column: 'account_id' | 'created_by') => {
    const rows: { key: string | null; bills: number; cents: string }[] =
      await manager.query(
        `SELECT ${column} AS key, count(*)::int AS bills, sum(price_cents)::text AS cents
         FROM bills GROUP BY ${column}`,
      );
    return new Map(rows.map((r) => [String(r.key), `${r.bills}/${r.cents}`]));
  };
  const asMap = (rows: (Totals & { key: string })[]) =>
    new Map(rows.map((r) => [r.key, `${r.bills}/${r.cents}`]));
  const differences = (
    label: string,
    actual: Map<string, string>,
    expected: Map<string, string>,
  ) =>
    [...new Set([...actual.keys(), ...expected.keys()])]
      .filter((key) => actual.get(key) !== expected.get(key))
      .map(
        (key) =>
          `${label} ${key} (v1 ${expected.get(key) ?? 'none'}, found ${actual.get(key) ?? 'none'})`,
      );
  const differs = [
    ...differences(
      'account',
      await read('account_id'),
      asMap(plan.v1Totals.perAccount.map((t) => ({ ...t, key: t.accountId }))),
    ),
    ...differences(
      'user',
      await read('created_by'),
      asMap(plan.v1Totals.perUser.map((t) => ({ ...t, key: t.userId }))),
    ),
  ];
  if (differs.length > 0) {
    throw new ImportError(
      `Totals differ for ${differs.join(', ')}; rolled back.`,
    );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
