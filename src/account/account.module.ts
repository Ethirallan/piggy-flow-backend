import { Module } from '@nestjs/common';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from './entities/account.entity';
import { UserModule } from 'src/user/user.module';
import { BillModule } from 'src/bill/bill.module';

@Module({
  imports: [TypeOrmModule.forFeature([Account]), UserModule, BillModule],
  controllers: [AccountController],
  providers: [AccountService]
})
export class AccountModule {}
