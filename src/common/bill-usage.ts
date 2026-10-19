import type { EntityManager } from 'typeorm';

/**
 * True while a bill of the account exists — or, with `ref`, one that uses
 * that shop or category. Raw SQL, so modules that don't load the Bill entity
 * (accounts, shops, categories) can ask. Scoped to the account so a member of
 * one account can't learn whether another account's shop is in use.
 */
export async function hasBills(
  manager: Pick<EntityManager, 'query'>,
  accountId: string,
  ref?: { column: 'shop_id' | 'category_id'; id: string },
): Promise<boolean> {
  const rows: { used: boolean }[] = ref
    ? await manager.query(
        `SELECT EXISTS (SELECT 1 FROM bills WHERE account_id = $1 AND ${ref.column} = $2) AS used`,
        [accountId, ref.id],
      )
    : await manager.query(
        'SELECT EXISTS (SELECT 1 FROM bills WHERE account_id = $1) AS used',
        [accountId],
      );
  return rows[0].used;
}
