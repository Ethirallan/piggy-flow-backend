import type { EntityManager } from 'typeorm';

/**
 * True while a subscription of the account uses that shop or category. Raw
 * SQL, so modules that don't load the Subscription entity can ask; scoped to
 * the account like hasBills.
 */
export async function hasSubscriptions(
  manager: Pick<EntityManager, 'query'>,
  accountId: string,
  ref: { column: 'shop_id' | 'category_id'; id: string },
): Promise<boolean> {
  const rows: { used: boolean }[] = await manager.query(
    `SELECT EXISTS (SELECT 1 FROM subscriptions WHERE account_id = $1 AND ${ref.column} = $2) AS used`,
    [accountId, ref.id],
  );
  return rows[0].used;
}
