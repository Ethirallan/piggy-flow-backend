import { Test, TestingModule } from '@nestjs/testing';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

describe('AccountController', () => {
  let controller: AccountController;
  let accountService: AccountService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [
        {
          provide: 'ACCOUNT_SERVICE',
          useValue: {
            create: jest.fn().mockResolvedValue('account'),
            getAccountsByUserId: jest.fn().mockResolvedValue(['accounts']),
            getPersonalAccount: jest.fn().mockResolvedValue('personalAccount'),
            update: jest.fn().mockResolvedValue('update'),
            remove: jest.fn().mockResolvedValue('remove'),
          },
        },
      ],
    }).compile();

    controller = module.get<AccountController>(AccountController);
    accountService = module.get<AccountService>('ACCOUNT_SERVICE');
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
    expect(accountService).toBeDefined();
  });

  it('should create an account', async () => {
    const dto = new CreateAccountDto();
    expect(await controller.create({ user: { id: 1 } }, dto)).toEqual('account');
    expect(accountService.create).toHaveBeenCalledWith({ ...dto, users: [{ id: 1 }] });
  });

  it('should get accounts by user id', async () => {
    expect(await controller.getAccountsByUserId({ user: { id: 1 } })).toEqual(['personalAccount', 'accounts']);
    expect(accountService.getAccountsByUserId).toHaveBeenCalledWith(1);
    expect(accountService.getPersonalAccount).toHaveBeenCalledWith(1);
  });

  it('should update an account', async () => {
    const dto = new UpdateAccountDto();
    expect(await controller.update(1, dto)).toEqual('update');
    expect(accountService.update).toHaveBeenCalledWith(1, dto);
  });

  it('should remove an account', async () => {
    expect(await controller.remove(1)).toEqual('remove');
    expect(accountService.remove).toHaveBeenCalledWith(1);
  });
});