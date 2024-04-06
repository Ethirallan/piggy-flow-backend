import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { Account } from './entities/account.entity';
import { UserService } from 'src/user/user.service';
import { BillService } from 'src/bill/bill.service';

@Injectable()
export class AccountService {
  constructor(
    @InjectRepository(Account)
    private accountRepository: Repository<Account>,
    private readonly userService: UserService,
    private readonly billService: BillService,
  ) { }

  create(createAccountDto: CreateAccountDto) {
    return this.accountRepository.save(createAccountDto);
  }

  async getAccountsByUserId(id: number) {
    try {
      const accounts = await this.accountRepository.createQueryBuilder('account')
        .leftJoinAndSelect('account.users', 'user', 'user.id =:id', { id })
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

  async update(id: number, updateAccountDto: UpdateAccountDto) {
    const updateResult = await this.accountRepository.update(id, updateAccountDto);

    if (updateResult.affected === 0) {
      throw new NotFoundException(`Account with ID "${id}" not found`);
    }
  }

  async remove(id: number) {
    const deleteResult = await this.accountRepository.delete(id);

    if (deleteResult.affected === 0) {
      throw new NotFoundException(`Account with ID "${id}" not found`);
    }
    return this.accountRepository.delete(id);
  }

  async getPersonalAccount(userId: number) {
    const { categories, shops, subscriptions, ...user } = await this.userService.getlUserWithRelationsById(userId);
    const bills = await this.billService.getPersonalBillsByUserId(userId);

    return {
      id: null,
      name: 'Personal',
      created: null,
      lastUpdate: null,
      users: [user],
      bills: bills,
      categories: categories,
      shops: shops,
      subscriptions: subscriptions
    };
  }
}
