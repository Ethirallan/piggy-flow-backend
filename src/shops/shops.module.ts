import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module.js';
import { Shop } from './shop.entity.js';
import { ShopsService } from './shops.service.js';

@Module({
  imports: [AccountsModule, TypeOrmModule.forFeature([Shop])],
  providers: [ShopsService],
  exports: [ShopsService],
})
export class ShopsModule {}
