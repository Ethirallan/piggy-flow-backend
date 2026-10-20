import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module.js';
import { Subscription } from './subscription.entity.js';
import { SubscriptionChargerService } from './subscription-charger.service.js';
import { SubscriptionsScheduler } from './subscriptions.scheduler.js';
import { SubscriptionsService } from './subscriptions.service.js';

@Module({
  imports: [AccountsModule, TypeOrmModule.forFeature([Subscription])],
  providers: [
    SubscriptionsService,
    SubscriptionChargerService,
    SubscriptionsScheduler,
  ],
  exports: [SubscriptionsService, SubscriptionChargerService],
})
export class SubscriptionsModule {}
