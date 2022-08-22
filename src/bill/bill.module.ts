import { Module } from '@nestjs/common';
import { BillService } from './bill.service';
import { BillController } from './bill.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bill } from './entities/bill.entity';
import { BillPhoto } from './entities/bill_photo.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Bill, BillPhoto])],
  controllers: [BillController],
  providers: [BillService]
})
export class BillModule {}
