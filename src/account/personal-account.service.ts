import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/user/entities/user.entity';
import { Account } from './entities/account.entity';

@Injectable()
export class PersonalAccountService {
  constructor(@InjectRepository(Account) private accounts: Repository<Account>) {}

  /** Returns the user's Personal account, creating it when there is none. */
  async ensurePersonal(userId: number): Promise<Account> {
    const existing = await this.accounts
      .createQueryBuilder('account')
      .innerJoin('account.users', 'user', 'user.id = :userId', { userId })
      .where('account.personal = true')
      .getOne();
    if (existing) return existing;
    return this.accounts.save({ name: 'Personal', personal: true, users: [{ id: userId }] as User[] });
  }
}
