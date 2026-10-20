import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
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
  processPhoto,
  type ProcessedPhoto,
} from '../../photos/photo-processing.js';
import type { PhotoStorage } from '../../photos/photo-storage.js';
import { Shop } from '../../shops/shop.entity.js';
import { Subscription } from '../../subscriptions/subscription.entity.js';
import type { Plan, V2User } from './plan.js';

export class ImportError extends Error {}

export interface ApplyResult {
  photos: number;
  bytesBefore: number;
  bytesAfter: number;
}

const BATCH = 500;

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

/** Every planned photo's file exists; returns the folder's files no row uses. */
export async function checkSources(
  plan: Plan,
  sourceDir: string,
): Promise<{ unreferenced: string[] }> {
  const missing: string[] = [];
  for (const photo of plan.photos) {
    try {
      if (!(await stat(join(sourceDir, photo.source))).isFile())
        missing.push(photo.source);
    } catch {
      missing.push(photo.source);
    }
  }
  if (missing.length > 0) {
    throw new ImportError(
      `Photo files missing in ${sourceDir}: ${missing.join(', ')}`,
    );
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
 * Converts the photos, then writes every row in one transaction and checks
 * the totals before committing. On any failure nothing stays: the
 * transaction rolls back and the photo files written here are deleted.
 */
export async function applyPlan(
  dataSource: DataSource,
  plan: Plan,
  sourceDir: string,
  storage: PhotoStorage,
): Promise<ApplyResult> {
  await assertV2Empty(dataSource);
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
          `photo ${photo.source} can't be converted: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await storage.write(photo.id, processed.jpeg);
      written.push(photo.id);
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
      await manager.query('SET LOCAL statement_timeout = 0');
      await assertV2Empty(manager); // nothing written since the first check
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
      await storage.delete(id);
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

async function verifyTotals(manager: EntityManager, plan: Plan): Promise<void> {
  const rows: { account_id: string; bills: number; cents: string }[] =
    await manager.query(
      `SELECT account_id, count(*)::int AS bills, sum(price_cents)::text AS cents FROM bills GROUP BY account_id`,
    );
  const actual = new Map(
    rows.map((r) => [r.account_id, `${r.bills}/${r.cents}`]),
  );
  const expected = new Map(
    plan.expected.map((e) => [e.accountId, `${e.bills}/${e.cents}`]),
  );
  const differs = [...new Set([...actual.keys(), ...expected.keys()])].filter(
    (id) => actual.get(id) !== expected.get(id),
  );
  if (differs.length > 0) {
    throw new ImportError(
      `Totals differ for ${differs.map((id) => `${id} (expected ${expected.get(id) ?? 'none'}, found ${actual.get(id) ?? 'none'})`).join(', ')}; rolled back.`,
    );
  }
}
