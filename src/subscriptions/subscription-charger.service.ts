import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';
import {
  CHARGE_TIME_ZONE,
  dueFilter,
  dueMonths,
  localToday,
  monthOf,
} from './charge-schedule.js';
import { Subscription } from './subscription.entity.js';

/** Turns due subscription months into bills, at most one per month, never twice. */
@Injectable()
export class SubscriptionChargerService {
  private readonly logger = new Logger(SubscriptionChargerService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    private readonly dataSource: DataSource,
  ) {}

  /** Charges every due month up to `today` (a Ljubljana date). Returns the number of bills created. */
  async run(today = localToday()): Promise<number> {
    // The ones with a due month (see dueFilter); each is re-checked under its lock.
    const candidates = await this.subscriptions
      .createQueryBuilder('subscription')
      .select(['subscription.id', 'subscription.accountId'])
      .where('subscription.lastChargedMonth < :thisMonth')
      .andWhere(
        '(subscription.lastChargedMonth < :previousMonth OR LEAST(subscription.chargeDay, :daysInMonth) <= :day)',
      )
      .setParameters(dueFilter(today))
      .getMany();

    let created = 0;
    for (const candidate of candidates) {
      try {
        created += await this.chargeOne(
          candidate.id,
          candidate.accountId,
          today,
        );
      } catch (error) {
        this.logger.error({
          event: 'subscriptions.charge_failed',
          subscriptionId: candidate.id,
          error: String(error),
        });
      }
    }
    if (created > 0) {
      this.logger.log({ event: 'subscriptions.charged', bills: created });
    }
    return created;
  }

  /** Charges one subscription, following it (twice at most) if it moves to another account meanwhile. */
  private async chargeOne(
    id: string,
    accountId: string,
    today: string,
  ): Promise<number> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await this.dataSource.transaction((manager) =>
        this.charge(manager, id, accountId, today),
      );
      if (typeof result === 'number') {
        return result;
      }
      accountId = result.movedTo;
    }
    return 0; // keeps moving: the next run picks it up
  }

  /** Bills created, or the account the subscription moved to after it was selected. */
  private async charge(
    manager: EntityManager,
    id: string,
    accountId: string,
    today: string,
  ): Promise<number | { movedTo: string }> {
    // Account first (KEY SHARE, which the bill inserts need anyway), then the
    // subscription: the same order as account delete, so they can't deadlock.
    await manager.query('SELECT 1 FROM accounts WHERE id = $1 FOR KEY SHARE', [
      accountId,
    ]);
    const subscription = await manager.getRepository(Subscription).findOne({
      where: { id },
      lock: { mode: 'for_no_key_update' },
    });
    if (!subscription) {
      return 0; // deleted meanwhile
    }
    if (subscription.accountId !== accountId) {
      // Moved meanwhile: the account we locked is the wrong one.
      return { movedTo: subscription.accountId };
    }
    const dates = dueMonths(
      subscription.lastChargedMonth,
      subscription.chargeDay,
      today,
    );
    for (const date of dates) {
      await manager.query(
        `INSERT INTO bills (account_id, date, price_cents, shop_id, category_id, comment, subscription_id)
         VALUES ($1, ($2::date)::timestamp AT TIME ZONE $3, $4, $5, $6, $7, $8)`,
        [
          subscription.accountId,
          date,
          CHARGE_TIME_ZONE,
          subscription.priceCents,
          subscription.shopId,
          subscription.categoryId,
          subscription.name,
          subscription.id,
        ],
      );
    }
    if (dates.length > 0) {
      // Raw, so a scheduler run doesn't change the subscription's updated_at.
      await manager.query(
        'UPDATE subscriptions SET last_charged_month = $1 WHERE id = $2',
        [monthOf(dates[dates.length - 1]), subscription.id],
      );
    }
    return dates.length;
  }
}
