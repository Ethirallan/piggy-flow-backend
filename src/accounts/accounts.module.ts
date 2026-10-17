import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module.js';
import { AccountMember } from './account-member.entity.js';
import { AccountMembersController } from './account-members.controller.js';
import { AccountMembersService } from './account-members.service.js';
import { Account } from './account.entity.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';

@Module({
  imports: [UsersModule, TypeOrmModule.forFeature([Account, AccountMember])],
  controllers: [AccountsController, AccountMembersController],
  providers: [AccountsService, AccountMembersService],
  exports: [AccountsService],
})
export class AccountsModule {}
