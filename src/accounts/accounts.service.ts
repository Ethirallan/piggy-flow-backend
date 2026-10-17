import { Injectable, NotFoundException } from '@nestjs/common';
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
    if (!account || !(await this.members.existsBy({ accountId, userId }))) {
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
