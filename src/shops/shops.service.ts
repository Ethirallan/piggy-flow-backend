import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service.js';
import { compareByName } from '../common/compare-by-name.js';
import { rethrowListWriteError } from '../common/list-write-errors.js';
import { Shop } from './shop.entity.js';

export const SHOP_NAME_TAKEN = 'A shop with that name already exists';
export const SHOP_NOT_FOUND = 'Shop not found';

@Injectable()
export class ShopsService {
  constructor(
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
    private readonly accounts: AccountsService,
  ) {}

  /** The account's shops, by name ignoring case, then oldest first. */
  async list(accountId: string, userId: string): Promise<Shop[]> {
    await this.accounts.findForMember(accountId, userId);
    const shops = await this.shops.findBy({ accountId });
    return shops.sort(compareByName);
  }

  async create(accountId: string, userId: string, name: string): Promise<Shop> {
    await this.accounts.findForMember(accountId, userId);
    try {
      return await this.shops.save(this.shops.create({ accountId, name }));
    } catch (error) {
      rethrowListWriteError(error, SHOP_NAME_TAKEN);
    }
  }

  /** A filtered UPDATE, never save(): a shop deleted meanwhile stays deleted (404). */
  async rename(
    accountId: string,
    userId: string,
    id: string,
    name: string,
  ): Promise<Shop> {
    await this.accounts.findForMember(accountId, userId);
    let affected: number | undefined;
    try {
      ({ affected } = await this.shops.update({ id, accountId }, { name }));
    } catch (error) {
      rethrowListWriteError(error, SHOP_NAME_TAKEN);
    }
    const shop = affected
      ? await this.shops.findOneBy({ id, accountId })
      : null;
    if (!shop) {
      throw new NotFoundException(SHOP_NOT_FOUND);
    }
    return shop;
  }

  async delete(accountId: string, userId: string, id: string): Promise<void> {
    await this.accounts.findForMember(accountId, userId);
    // Bills and subscriptions add their "still in use" 409 check here; their
    // ON DELETE RESTRICT foreign keys back it up.
    const { affected } = await this.shops.delete({ id, accountId });
    if (!affected) {
      throw new NotFoundException(SHOP_NOT_FOUND);
    }
  }
}
