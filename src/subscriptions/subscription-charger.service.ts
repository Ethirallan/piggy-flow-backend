import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';
import {
  CHARGE_TIME_ZONE,
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
    // Not charged this month yet: a superset of the due ones (this month's
    // day may still be ahead); each is re-checked under its lock.
    const candidates = await this.subscriptions
      .createQueryBuilder('subscription')
      .select(['subscription.id', 'subscription.accountId'])
      .where('subscription.lastChargedMonth < :thisMonth', {
        thisMonth: monthOf(today),
      })
      .getMany();

    let created = 0;
    for (const candidate of candidates) {
      try {
        created += await this.dataSource.transaction((manager) =>
          this.charge(manager, candidate.id, candidate.accountId, today),
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

  private async charge(
    manager: EntityManager,
    id: string,
    accountId: string,
    today: string,
  ): Promise<number> {
    // Account first (KEY SHARE, which the bill inserts need anyway), then the
    // subscription: the same order as account delete, so they can't deadlock.
    await manager.query('SELECT 1 FROM accounts WHERE id = $1 FOR KEY SHARE', [
      accountId,
    ]);
    const subscription = await manager.getRepository(Subscription).findOne({
      where: { id },
      lock: { mode: 'for_no_key_update' },
    });
    if (!subscription || subscription.accountId !== accountId) {
      return 0; // deleted, or moved meanwhile: the next run picks it up
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
