import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service.js';
import { compareByName } from '../common/compare-by-name.js';
import { hasBills } from '../common/bill-usage.js';
import { isRestrictViolation } from '../common/db-errors.js';
import { rethrowListWriteError } from '../common/list-write-errors.js';
import { hasSubscriptions } from '../common/subscription-usage.js';
import { Shop } from './shop.entity.js';

export const SHOP_NAME_TAKEN = 'A shop with that name already exists';
export const SHOP_IN_USE = 'Shop is in use by bills';
export const SHOP_IN_USE_BY_SUBSCRIPTIONS = 'Shop is in use by subscriptions';
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
    if (
      await hasBills(this.shops.manager, accountId, {
        column: 'shop_id',
        id,
      })
    ) {
      throw new ConflictException(SHOP_IN_USE);
    }
    if (
      await hasSubscriptions(this.shops.manager, accountId, {
        column: 'shop_id',
        id,
      })
    ) {
      throw new ConflictException(SHOP_IN_USE_BY_SUBSCRIPTIONS);
    }
    // A bill or subscription saved after the checks trips the RESTRICT
    // foreign key: the same 409s.
    let affected: number | null | undefined;
    try {
      ({ affected } = await this.shops.delete({ id, accountId }));
    } catch (error) {
      if (isRestrictViolation(error)) {
        // A bill or subscription saved after the checks: say which.
        throw new ConflictException(
          (await hasBills(this.shops.manager, accountId, {
            column: 'shop_id',
            id,
          }))
            ? SHOP_IN_USE
            : SHOP_IN_USE_BY_SUBSCRIPTIONS,
        );
      }
      throw error;
    }
    if (!affected) {
      throw new NotFoundException(SHOP_NOT_FOUND);
    }
  }
}
