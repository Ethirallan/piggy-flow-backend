import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';
import { compareAccounts } from './account-order.js';
import { AccountMember } from './account-member.entity.js';
import { Account } from './account.entity.js';

export const PERSONAL_ACCOUNT_NAME = 'Personal';
export const ACCOUNT_NOT_FOUND = 'Account not found';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
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

  /**
   * The account, if `userId` is a member. Otherwise 404, so outsiders can't
   * tell whether it exists. Every feature that touches an account checks here.
   */
  async findForMember(accountId: string, userId: string): Promise<Account> {
    const account = await this.accounts.findOneBy({ id: accountId });
    return this.requireMember(account, userId, this.members);
  }

  /**
   * Like findForMember, but locks the account row until `manager`'s
   * transaction ends, so changes that depend on the member list can't
   * interleave.
   */
  async lockForMember(
    accountId: string,
    userId: string,
    manager: EntityManager,
    // FOR NO KEY UPDATE still serializes member changes with each other and
    // with delete, but not with inserts of rows that reference the account
    // (shops, categories), whose foreign-key check takes FOR KEY SHARE.
    // Delete passes FOR UPDATE: it must wait for and block those inserts.
    mode: 'for_no_key_update' | 'pessimistic_write' = 'for_no_key_update',
  ): Promise<Account> {
    const account = await manager.getRepository(Account).findOne({
      where: { id: accountId },
      lock: { mode },
    });
    return this.requireMember(
      account,
      userId,
      manager.getRepository(AccountMember),
    );
  }

  rename(accountId: string, userId: string, name: string): Promise<Account> {
    return this.dataSource.transaction(async (manager) => {
      const account = await this.lockForMember(accountId, userId, manager);
      account.name = name;
      return manager.getRepository(Account).save(account);
    });
  }

  async delete(accountId: string, userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const account = await this.lockForMember(
        accountId,
        userId,
        manager,
        'pessimistic_write',
      );
      if (account.isPersonal) {
        throw new ConflictException("The Personal account can't be deleted");
      }
      // Shops, categories, bills and subscriptions add their "still in use"
      // 409 checks here; their ON DELETE RESTRICT foreign keys back them up.
      await manager.getRepository(Account).delete({ id: account.id });
    });
  }

  private async requireMember(
    account: Account | null,
    userId: string,
    members: Repository<AccountMember>,
  ): Promise<Account> {
    if (
      !account ||
      !(await members.existsBy({ accountId: account.id, userId }))
    ) {
      throw new NotFoundException(ACCOUNT_NOT_FOUND);
    }
    return account;
  }

  /** The account and its members (with their users), in the order they joined. */
  async details(
    accountId: string,
    userId: string,
  ): Promise<{ account: Account; members: AccountMember[] }> {
    const account = await this.findForMember(accountId, userId);
    const members = await this.members.find({
      where: { accountId },
      relations: { user: true },
      order: { joinedAt: 'ASC', userId: 'ASC' },
    });
    return { account, members };
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
