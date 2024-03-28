import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { Account } from './entities/account.entity';

@Injectable()
export class AccountService {
  constructor(
    @InjectRepository(Account)
    private accountRepository: Repository<Account>,
  ) { }

  create(createAccountDto: CreateAccountDto) {
    return this.accountRepository.save(createAccountDto);
  }

  async getAccountsByUserId(id: number) {
    try {
      const accounts = await this.accountRepository.createQueryBuilder('account')
        .leftJoinAndSelect('account.users', 'user', 'user.id =:id', {id})
        .leftJoinAndSelect('account.bills', 'bill')
        .leftJoinAndSelect('account.categories', 'category')
        .leftJoinAndSelect('account.shops', 'shop')
        .leftJoinAndSelect('account.subscriptions', 'subscription')
        .orderBy('account.id', 'DESC')
        .getMany();

      return accounts;
    } catch (error) {
      console.log(error);
      return [];
    }
  }

  update(id: number, updateAccountDto: UpdateAccountDto) {
    return this.accountRepository.update(id, updateAccountDto);
  }

  remove(id: number) {
    return this.accountRepository.delete(id);
  }
}
