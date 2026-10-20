import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  IsNull,
  Repository,
  type SelectQueryBuilder,
} from 'typeorm';
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
import {
  initialLastChargedMonth,
  lastChargedMonthAfterDayChange,
  localToday,
  nextChargeDate,
} from './charge-schedule.js';
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

export interface SubscriptionChanges {
  accountId?: string;
  priceCents?: number;
  chargeDay?: number;
  /** null clears it. */
  name?: string | null;
  /** null clears it. */
  shopId?: string | null;
  /** null clears it. */
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

  /** The caller's subscriptions (or one account's), by next charge date, then name. */
  async list(userId: string, accountId?: string): Promise<Subscription[]> {
    if (accountId !== undefined) {
      await this.accounts.findForMember(accountId, userId);
    }
    const query = this.visible(userId);
    if (accountId !== undefined) {
      query.andWhere('subscription.accountId = :accountId', { accountId });
    }
    const found = await query.getMany();
    const key = (s: Subscription) =>
      nextChargeDate(s.lastChargedMonth, s.chargeDay);
    return found.sort(
      (a, b) =>
        key(a).localeCompare(key(b)) ||
        (a.name ?? '').localeCompare(b.name ?? '', 'en', {
          sensitivity: 'accent',
        }) ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  /**
   * Partial update, incl. moving to another account (membership there, shop
   * and category must exist there). A filtered UPDATE pinning what was read
   * and checked — never save().
   */
  async update(
    userId: string,
    id: string,
    changes: SubscriptionChanges,
    today = localToday(),
  ): Promise<Subscription> {
    if (Object.values(changes).every((value) => value === undefined)) {
      throw new BadRequestException('Nothing to update');
    }
    // A concurrent change (e.g. a charge between the read and the UPDATE)
    // makes the pinned UPDATE miss: try once more against a fresh read.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (await this.tryUpdate(userId, id, changes, today)) {
        return this.findForMember(id, userId);
      }
    }
    throw new NotFoundException(SUBSCRIPTION_NOT_FOUND);
  }

  /** One read-check-UPDATE pass; false when the row changed after it was read. */
  private async tryUpdate(
    userId: string,
    id: string,
    changes: SubscriptionChanges,
    today: string,
  ): Promise<boolean> {
    const current = await this.findForMember(id, userId);
    const accountId = changes.accountId ?? current.accountId;
    if (accountId !== current.accountId) {
      await this.accounts.findForMember(accountId, userId);
    }
    const shopId =
      changes.shopId !== undefined ? changes.shopId : current.shopId;
    const categoryId =
      changes.categoryId !== undefined
        ? changes.categoryId
        : current.categoryId;
    await assertListsInAccount(
      this.dataSource.manager,
      accountId,
      shopId,
      categoryId,
    );

    const set: Partial<
      Pick<
        Subscription,
        | 'accountId'
        | 'priceCents'
        | 'chargeDay'
        | 'name'
        | 'shopId'
        | 'categoryId'
        | 'lastChargedMonth'
        | 'updatedById'
      >
    > = { updatedById: userId };
    if (changes.accountId !== undefined) set.accountId = changes.accountId;
    if (changes.priceCents !== undefined) set.priceCents = changes.priceCents;
    if (changes.name !== undefined) set.name = normalizeName(changes.name);
    if (changes.shopId !== undefined) set.shopId = changes.shopId;
    if (changes.categoryId !== undefined) set.categoryId = changes.categoryId;
    const dayChanged =
      changes.chargeDay !== undefined &&
      changes.chargeDay !== current.chargeDay;
    if (changes.chargeDay !== undefined) set.chargeDay = changes.chargeDay;
    if (dayChanged) {
      set.lastChargedMonth = lastChargedMonthAfterDayChange(
        current.lastChargedMonth,
        changes.chargeDay!,
        today,
      );
    }

    let affected: number | null | undefined;
    try {
      ({ affected } = await this.subscriptions.update(
        {
          id,
          accountId: current.accountId,
          ...(changes.shopId === undefined && {
            shopId: current.shopId ?? IsNull(),
          }),
          ...(changes.categoryId === undefined && {
            categoryId: current.categoryId ?? IsNull(),
          }),
          // A run that charged meanwhile must not be undone.
          ...(dayChanged && { lastChargedMonth: current.lastChargedMonth }),
        },
        set,
      ));
    } catch (error) {
      rethrowSubscriptionWriteError(error);
    }
    return Boolean(affected);
  }

  /** Deletes it; its bills stay (their subscription_id becomes null). */
  async delete(userId: string, id: string): Promise<void> {
    const current = await this.findForMember(id, userId);
    const { affected } = await this.subscriptions.delete({
      id,
      accountId: current.accountId,
    });
    if (!affected) {
      throw new NotFoundException(SUBSCRIPTION_NOT_FOUND);
    }
  }

  /** Subscriptions of the accounts `userId` belongs to, with what a response shows. */
  private visible(userId: string): SelectQueryBuilder<Subscription> {
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
