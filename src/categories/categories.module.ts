import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module.js';
import { Category } from './category.entity.js';
import { CategoriesService } from './categories.service.js';

@Module({
  imports: [AccountsModule, TypeOrmModule.forFeature([Category])],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
