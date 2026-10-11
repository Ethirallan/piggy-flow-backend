import { Module } from '@nestjs/common';
import { CategoryService } from './category.service';
import { CategoryController } from './category.controller';
import { Bill } from 'src/bill/entities/bill.entity';
import { Subscription } from 'src/subscription/entities/subscription.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountModule } from 'src/account/account.module';
import { Category } from './entities/category.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Category, Bill, Subscription]), AccountModule],
  controllers: [CategoryController],
  providers: [CategoryService]
})
export class CategoryModule {}
