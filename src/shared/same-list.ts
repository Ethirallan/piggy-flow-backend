import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Category } from 'src/category/entities/category.entity';
import { Shop } from 'src/shop/entities/shop.entity';

/**
 * R2: a bill's or subscription's shop and category must belong to its own
 * account. Unset (null/undefined) ones pass. A shop or category that does not
 * exist, or is not a `{ id: <integer> }` reference, gets the same 400: it is
 * not from the account either.
 */
export async function assertSameList(
  manager: Pick<EntityManager, 'findOne'>,
  account: { id?: number } | null | undefined,
  shop: unknown,
  category: unknown,
): Promise<void> {
  for (const [entity, ref] of [[Shop, shop], [Category, category]] as const) {
    if (ref == null) continue;
    const id = (ref as { id?: unknown }).id;
    const row = Number.isInteger(id)
      ? await manager.findOne<Shop | Category>(entity, { where: { id: id as number }, relations: ['account'] })
      : null;
    if (row?.account?.id == null || row.account.id !== account?.id) {
      throw new BadRequestException("Shop and category must be from the bill's account.");
    }
  }
}
