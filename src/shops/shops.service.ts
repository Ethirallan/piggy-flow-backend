import { Injectable } from '@nestjs/common';
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
}
