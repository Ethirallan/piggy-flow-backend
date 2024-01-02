import { Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from './entities/subscription.entity';
import { BillService } from 'src/bill/bill.service';
import { Bill } from 'src/bill/entities/bill.entity';
import { BillPhoto } from 'src/bill/entities/bill_photo.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Subscription, Bill, BillPhoto])],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, BillService],
})
export class SubscriptionModule { }
