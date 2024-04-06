import { Test, TestingModule } from '@nestjs/testing';
import { AccountService } from './account.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Account } from './entities/account.entity';
import { Repository } from 'typeorm';
import { UserService } from 'src/user/user.service';
import { BillService } from 'src/bill/bill.service';
import { UpdateAccountDto } from './dto/update-account.dto';
import { NotFoundException } from '@nestjs/common';
import { CreateAccountDto } from './dto/create-account.dto';

describe('AccountService', () => {
  let service: AccountService;
  let repo: Repository<Account>;
  let userService: UserService;
  let billService: BillService;
  const ACCOUNT_REPOSITORY_TOKEN = getRepositoryToken(Account);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        {
          provide: ACCOUNT_REPOSITORY_TOKEN,
          useValue: {
            save: jest.fn().mockResolvedValue('account'),
            createQueryBuilder: jest.fn(() => ({
              leftJoinAndSelect: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue('accounts'),
            })),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            delete: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
        {
          provide: UserService,
          useValue: {
            getlUserWithRelationsById: jest.fn().mockResolvedValue({
              categories: 'categories',
              shops: 'shops',
              subscriptions: 'subscriptions',
              displayName: 'user',
            }),
          },
        },
        {
          provide: BillService,
          useValue: {
            getPersonalBillsByUserId: jest.fn().mockResolvedValue('bills'),
          },
        },
      ],
    }).compile();

    service = module.get<AccountService>(AccountService);
    repo = module.get<Repository<Account>>(ACCOUNT_REPOSITORY_TOKEN);
    userService = module.get<UserService>(UserService);
    billService = module.get<BillService>(BillService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(repo).toBeDefined();
    expect(userService).toBeDefined();
    expect(billService).toBeDefined();
  });

  it('should create an account', async () => {
    const dto = new CreateAccountDto();
    expect(await service.create(dto)).toEqual('account');
    expect(repo.save).toHaveBeenCalledWith(dto);
  });

  it('should get accounts by user id', async () => {
    expect(await service.getAccountsByUserId(1)).toEqual('accounts');
    expect(repo.createQueryBuilder).toHaveBeenCalledWith('account');
  });

  it('should update an account', async () => {
    const dto = new UpdateAccountDto();
    await service.update(1, dto);
    expect(repo.update).toHaveBeenCalledWith(1, dto);
  });

  it('should throw a NotFoundException if no account is updated', async () => {
    (repo.update as jest.Mock).mockResolvedValue({ affected: 0 });
    await expect(service.update(1, new UpdateAccountDto())).rejects.toThrow(NotFoundException);
  });

  it('should remove an account', async () => {
    await service.remove(1);
    expect(repo.delete).toHaveBeenCalledWith(1);
  });

  it('should throw a NotFoundException if no account is removed', async () => {
    (repo.delete as jest.Mock).mockResolvedValue({ affected: 0 });
    await expect(service.remove(1)).rejects.toThrow(NotFoundException);
  });

  it('should get a personal account', async () => {
    expect(await service.getPersonalAccount(1)).toEqual({
      id: null,
      name: 'Personal',
      created: null,
      lastUpdate: null,
      users: [{ displayName: 'user' }],
      bills: 'bills',
      categories: 'categories',
      shops: 'shops',
      subscriptions: 'subscriptions'
    });
    expect(userService.getlUserWithRelationsById).toHaveBeenCalledWith(1);
    expect(billService.getPersonalBillsByUserId).toHaveBeenCalledWith(1);
  });
});