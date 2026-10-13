import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
  ) {}

  /** Saves only the name and members, never a client id, `personal` flag or timestamps. */
  create(createAccountDto: CreateAccountDto) {
    return this.accountRepository.save({ name: createAccountDto.name, users: createAccountDto.users });
  }

  async getAccountsByUserId(id: number) {
    try {
      const accounts = await this.accountRepository
        .createQueryBuilder('account')
        .leftJoinAndSelect('account.users', 'user', 'user.id =:id', { id })
        .where('user.id = :id', { id })
        .orderBy('account.personal', 'DESC')
        .addOrderBy('account.id', 'DESC')
        .getMany();

      return accounts;
    } catch (error) {
      console.log(error);
      return [];
    }
  }

  async assertMember(accountId: number, userId: number | undefined): Promise<Account> {
    if (userId == null) throw new NotFoundException();
    const account = await this.accountRepository.findOne({ where: { id: accountId }, relations: ['users'] });
    if (!account || !account.users?.some((u) => u.id === userId)) throw new NotFoundException();
    return account;
  }

  async updateMember(id: number, userId: number | undefined, dto: UpdateAccountDto) {
    await this.assertMember(id, userId);
    if (dto.name === undefined) return;
    return this.accountRepository.update(id, { name: dto.name });
  }

  async removeMember(id: number, userId: number | undefined) {
    const account = await this.assertMember(id, userId);
    if (account.personal) throw new BadRequestException("The Personal account can't be deleted.");
    return this.accountRepository.delete(id);
  }
}
