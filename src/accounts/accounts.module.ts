import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountMember } from './account-member.entity.js';
import { Account } from './account.entity.js';
import { AccountsService } from './accounts.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Account, AccountMember])],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
