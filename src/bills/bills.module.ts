import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module.js';
import { Bill } from './bill.entity.js';
import { BillsService } from './bills.service.js';

@Module({
  imports: [AccountsModule, TypeOrmModule.forFeature([Bill])],
  providers: [BillsService],
  exports: [BillsService],
})
export class BillsModule {}
