import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CHARGE_TIME_ZONE } from './charge-schedule.js';
import { SubscriptionChargerService } from './subscription-charger.service.js';

const chargesDisabled = () =>
  process.env.SUBSCRIPTION_CHARGES_DISABLED === 'true';

/** Charges subscriptions every day at 00:05 in Ljubljana, and once after startup. */
@Injectable()
export class SubscriptionsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubscriptionsScheduler.name);
  private running = false;

  constructor(private readonly charger: SubscriptionChargerService) {}

  /** Catches up after downtime; in the background, so startup doesn't wait. */
  onApplicationBootstrap(): void {
    void this.chargeDue();
  }

  @Cron('5 0 * * *', {
    name: 'subscription-charges',
    timeZone: CHARGE_TIME_ZONE,
  })
  async chargeDue(): Promise<void> {
    if (chargesDisabled() || this.running) {
      return;
    }
    this.running = true;
    try {
      await this.charger.run();
    } catch (error) {
      this.logger.error({
        event: 'subscriptions.run_failed',
        error: String(error),
      });
    } finally {
      this.running = false;
    }
  }
}
