import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';
import { compareAccounts } from './account-order.js';
import { AccountMember } from './account-member.entity.js';
import { Account } from './account.entity.js';

export const PERSONAL_ACCOUNT_NAME = 'Personal';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(AccountMember)
    private readonly members: Repository<AccountMember>,
    private readonly dataSource: DataSource,
  ) {}

  /** The user's accounts: Personal first, then by name. */
  async listForUser(userId: string): Promise<Account[]> {
    const memberships = await this.members.find({
      where: { userId },
      relations: { account: true },
    });
    return memberships
      .map((membership) => membership.account!)
      .sort(compareAccounts);
  }

  /** A shared account with the caller as its only member. */
  create(userId: string, name: string): Promise<Account> {
    return this.dataSource.transaction((manager) =>
      this.createWithMember(userId, name, false, manager),
    );
  }

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
