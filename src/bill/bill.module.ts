import { Module } from '@nestjs/common';
import { BillService } from './bill.service';
import { BillController } from './bill.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bill } from './entities/bill.entity';
import { BillPhoto } from './entities/bill_photo.entity';

import { AccountModule } from 'src/account/account.module';

@Module({
  imports: [TypeOrmModule.forFeature([Bill, BillPhoto]), AccountModule],
  controllers: [BillController],
  providers: [BillService],
  exports: [BillService]
})
export class BillModule {}
