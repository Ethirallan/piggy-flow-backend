import { Module } from '@nestjs/common';
import { AccountService } from './account.service';
import { PersonalAccountService } from './personal-account.service';
import { AccountController } from './account.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from './entities/account.entity';
import { Bill } from 'src/bill/entities/bill.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Account, Bill])],
  controllers: [AccountController],
  providers: [AccountService, PersonalAccountService],
  exports: [AccountService, PersonalAccountService]
})
export class AccountModule {}
