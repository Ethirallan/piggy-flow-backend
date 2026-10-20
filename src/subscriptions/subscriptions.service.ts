import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type SelectQueryBuilder } from 'typeorm';
import { AccountMember } from '../accounts/account-member.entity.js';
import {
  ACCOUNT_NOT_FOUND,
  AccountsService,
} from '../accounts/accounts.service.js';
import {
  assertListsInAccount,
  CATEGORY_NOT_IN_ACCOUNT,
  SHOP_NOT_IN_ACCOUNT,
} from '../common/account-lists.js';
import {
  isForeignKeyViolation,
  violatedConstraint,
} from '../common/db-errors.js';
import { initialLastChargedMonth, localToday } from './charge-schedule.js';
import {
  Subscription,
  SUBSCRIPTION_ACCOUNT_FK,
  SUBSCRIPTION_CATEGORY_FK,
  SUBSCRIPTION_SHOP_FK,
} from './subscription.entity.js';

export const SUBSCRIPTION_NOT_FOUND = 'Subscription not found';

export interface SubscriptionInput {
  accountId: string;
  priceCents: number;
  chargeDay: number;
  name?: string | null;
  shopId?: string | null;
  categoryId?: string | null;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    private readonly accounts: AccountsService,
    private readonly dataSource: DataSource,
  ) {}

  /** The subscription, if the caller is a member of its account; otherwise 404. One query. */
  async findForMember(id: string, userId: string): Promise<Subscription> {
    const subscription = await this.visible(userId)
      .where('subscription.id = :id', { id })
      .getOne();
    if (!subscription) {
      throw new NotFoundException(SUBSCRIPTION_NOT_FOUND);
    }
    return subscription;
  }

  async create(
    userId: string,
    input: SubscriptionInput,
    today = localToday(),
  ): Promise<Subscription> {
    await this.accounts.findForMember(input.accountId, userId);
    const shopId = input.shopId ?? null;
    const categoryId = input.categoryId ?? null;
    await assertListsInAccount(
      this.dataSource.manager,
      input.accountId,
      shopId,
      categoryId,
    );
    let id: string;
    try {
      ({ id } = await this.subscriptions.save(
        this.subscriptions.create({
          accountId: input.accountId,
          name: normalizeName(input.name),
          priceCents: input.priceCents,
          chargeDay: input.chargeDay,
          shopId,
          categoryId,
          lastChargedMonth: initialLastChargedMonth(input.chargeDay, today),
          createdById: userId,
          updatedById: userId,
        }),
      ));
    } catch (error) {
      rethrowSubscriptionWriteError(error);
    }
    return this.findForMember(id, userId);
  }

  /** Subscriptions of the accounts `userId` belongs to, with what a response shows. */
  protected visible(userId: string): SelectQueryBuilder<Subscription> {
    return this.subscriptions
      .createQueryBuilder('subscription')
      .innerJoin(
        AccountMember,
        'member',
        'member.accountId = subscription.accountId AND member.userId = :userId',
        { userId },
      )
      .leftJoinAndSelect('subscription.account', 'account')
      .leftJoinAndSelect('subscription.shop', 'shop')
      .leftJoinAndSelect('subscription.category', 'category')
      .leftJoin('subscription.createdBy', 'createdBy')
      .addSelect(['createdBy.id', 'createdBy.displayName'])
      .leftJoin('subscription.updatedBy', 'updatedBy')
      .addSelect(['updatedBy.id', 'updatedBy.displayName']);
  }
}

/** Trimmed; blank is null. */
export function normalizeName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed ? trimmed : null;
}

/** A reference deleted after it was checked: the account (404) or the shop / category (400). */
export function rethrowSubscriptionWriteError(error: unknown): never {
  if (isForeignKeyViolation(error)) {
    switch (violatedConstraint(error)) {
      case SUBSCRIPTION_ACCOUNT_FK:
        throw new NotFoundException(ACCOUNT_NOT_FOUND);
      case SUBSCRIPTION_SHOP_FK:
        throw new BadRequestException(SHOP_NOT_IN_ACCOUNT);
      case SUBSCRIPTION_CATEGORY_FK:
        throw new BadRequestException(CATEGORY_NOT_IN_ACCOUNT);
    }
  }
  throw error;
}
