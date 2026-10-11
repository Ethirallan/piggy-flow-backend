import { Module } from '@nestjs/common';
import { ShopService } from './shop.service';
import { ShopController } from './shop.controller';
import { Bill } from 'src/bill/entities/bill.entity';
import { Subscription } from 'src/subscription/entities/subscription.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountModule } from 'src/account/account.module';
import { Shop } from './entities/shop.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Shop, Bill, Subscription]), AccountModule],
  controllers: [ShopController],
  providers: [ShopService]
})
export class ShopModule {}
