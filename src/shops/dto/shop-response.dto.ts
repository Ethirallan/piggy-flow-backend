import type { Shop } from '../shop.entity.js';

export class ShopResponseDto {
  id: string;
  accountId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;

  static from(shop: Shop): ShopResponseDto {
    return {
      id: shop.id,
      accountId: shop.accountId,
      name: shop.name,
      createdAt: shop.createdAt,
      updatedAt: shop.updatedAt,
    };
  }
}
