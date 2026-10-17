import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AccountMember } from './account-member.entity.js';
import { Account } from './account.entity.js';

export const PERSONAL_ACCOUNT_NAME = 'Personal';

@Injectable()
export class AccountsService {
  /**
   * Only register calls this, inside its transaction: it's the one place a
   * Personal account is created, which keeps it to one per user.
   */
  createPersonal(userId: string, manager: EntityManager): Promise<Account> {
    return this.createWithMember(userId, PERSONAL_ACCOUNT_NAME, true, manager);
  }

  private async createWithMember(
    userId: string,
    name: string,
    isPersonal: boolean,
    manager: EntityManager,
  ): Promise<Account> {
    const accounts = manager.getRepository(Account);
    const account = await accounts.save(accounts.create({ name, isPersonal }));
    await manager
      .getRepository(AccountMember)
      .insert({ accountId: account.id, userId });
    return account;
  }
}
