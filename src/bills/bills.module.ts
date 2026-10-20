import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module.js';
import { PhotoStorageModule } from '../photos/photo-storage.module.js';
import { BillPhoto } from '../photos/bill-photo.entity.js';
import { Subscription } from '../subscriptions/subscription.entity.js';
import { Bill } from './bill.entity.js';
import { BillsController } from './bills.controller.js';
import { BillsService } from './bills.service.js';

@Module({
  imports: [
    AccountsModule,
    PhotoStorageModule,
    // Bill relates to Subscription; modules loading bills need its metadata.
    TypeOrmModule.forFeature([Bill, BillPhoto, Subscription]),
  ],
  controllers: [BillsController],
  providers: [BillsService],
  exports: [BillsService],
})
export class BillsModule {}
