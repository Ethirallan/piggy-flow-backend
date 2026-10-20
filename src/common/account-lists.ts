import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { Category } from '../categories/category.entity.js';
import { Shop } from '../shops/shop.entity.js';

export const SHOP_NOT_IN_ACCOUNT = 'Shop is not in this account';
export const CATEGORY_NOT_IN_ACCOUNT = 'Category is not in this account';

/** 400 unless the shop and category (when set) belong to the account. */
export async function assertListsInAccount(
  manager: EntityManager,
  accountId: string,
  shopId: string | null,
  categoryId: string | null,
): Promise<void> {
  if (
    shopId !== null &&
    !(await manager.getRepository(Shop).existsBy({ id: shopId, accountId }))
  ) {
    throw new BadRequestException(SHOP_NOT_IN_ACCOUNT);
  }
  if (
    categoryId !== null &&
    !(await manager
      .getRepository(Category)
      .existsBy({ id: categoryId, accountId }))
  ) {
    throw new BadRequestException(CATEGORY_NOT_IN_ACCOUNT);
  }
}
