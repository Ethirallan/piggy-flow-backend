import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AccountService } from 'src/account/account.service';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Bill } from 'src/bill/entities/bill.entity';
import { Subscription } from 'src/subscription/entities/subscription.entity';
import { CategoryService } from './category.service';
import { Category } from './entities/category.entity';

describe('CategoryService', () => {
  let service: CategoryService;
  const repo = { find: jest.fn(), findOne: jest.fn(), update: jest.fn(), delete: jest.fn(), save: jest.fn() };
  const accounts = { assertMember: jest.fn() };
  const bills = { count: jest.fn() };
  const subs = { count: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    accounts.assertMember.mockResolvedValue({ id: 1 });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoryService,
        { provide: getRepositoryToken(Category), useValue: repo },
        { provide: getRepositoryToken(Bill), useValue: bills },
        { provide: getRepositoryToken(Subscription), useValue: subs },
        { provide: AccountService, useValue: accounts },
      ],
    }).compile();
    service = module.get<CategoryService>(CategoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  const notMember = () => accounts.assertMember.mockRejectedValue(new NotFoundException());
  const categoryIn = (accountId = 3) =>
    repo.findOne.mockResolvedValue({ id: 5, name: 'Food', emoji: '🍕', account: { id: accountId } });

  describe('create', () => {
    it.each([[undefined], [null]])('gives 400 Invalid account. without an account (%j) and saves nothing', async (account) => {
      await expect(service.create({ name: 'x', emoji: '🍕', user: { id: 7 }, account } as any)).rejects.toMatchObject({
        status: 400,
        message: 'Invalid account.',
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('saves into a given account the user belongs to', async () => {
      repo.save.mockResolvedValue({ id: 1 });
      repo.findOne.mockResolvedValue({ id: 1, account: { id: 9 } });
      await expect(service.create({ name: 'x', emoji: '🍕', user: { id: 7 }, account: { id: 9 } } as any)).resolves.toEqual({
        id: 1,
        account: { id: 9 },
      });
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 1 }, relations: ['account'] });
      expect(accounts.assertMember).toHaveBeenCalledWith(9, 7);
      expect(repo.save).toHaveBeenCalledWith({ name: 'x', emoji: '🍕', account: { id: 9 } });
    });

    it('gives 404 for a foreign account and saves nothing', async () => {
      notMember();
      await expect(service.create({ name: 'x', user: { id: 7 }, account: { id: 9 } } as any)).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('gives 400 for a malformed account', async () => {
      await expect(service.create({ name: 'x', user: { id: 7 }, account: 9 } as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('gives 404 without a user and saves nothing', async () => {
      await expect(service.create({ name: 'x', user: null } as any)).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('listForUser', () => {
    it('lists one account after checking membership', async () => {
      repo.find.mockResolvedValue([{ id: 1 }]);
      await expect(service.listForUser(7, 3)).resolves.toEqual([{ id: 1 }]);
      expect(accounts.assertMember).toHaveBeenCalledWith(3, 7);
      expect(repo.find).toHaveBeenCalledWith({ where: { account: { id: 3 } }, relations: ['account'] });
    });

    it('gives 404 to a stranger listing an account', async () => {
      notMember();
      await expect(service.listForUser(7, 3)).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.find).not.toHaveBeenCalled();
    });

    it('lists only categories in the user\'s accounts when no account is given', async () => {
      repo.find.mockResolvedValue([]);
      await service.listForUser(7);
      expect(repo.find).toHaveBeenCalledWith({ where: { account: { users: { id: 7 } } }, relations: ['account'] });
    });

    it('gives 404 without a user', async () => {
      await expect(service.listForUser(undefined)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateAsMember', () => {
    it('lets a member change name and emoji only', async () => {
      categoryIn();
      repo.update.mockResolvedValue({ affected: 1 });
      const dto: any = { name: 'Food', emoji: '🍕', user: { id: 99 }, id: 99, account: { id: 1 } };
      await service.updateAsMember(5, 7, dto);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 5 }, relations: ['account'] });
      expect(accounts.assertMember).toHaveBeenCalledWith(3, 7);
      expect(repo.update).toHaveBeenCalledWith(5, { name: 'Food', emoji: '🍕' });
    });

    it('gives 404 for a stranger without updating', async () => {
      categoryIn();
      notMember();
      await expect(service.updateAsMember(5, 8, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it.each([[null], [{ id: 3 }]])('gives 404 for a missing category or one without an account (%j)', async (account) => {
      repo.findOne.mockResolvedValue(account === null ? null : { id: 5, account: null });
      await expect(service.updateAsMember(5, 7, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('gives 404 for a missing user without querying', async () => {
      await expect(service.updateAsMember(5, undefined, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it.each([[{}], [{ name: undefined }], [{ emoji: null }]])('gives 400 Nothing to update for %j', async (dto) => {
      categoryIn();
      await expect(service.updateAsMember(5, 7, dto as any)).rejects.toMatchObject({
        status: 400,
        message: 'Nothing to update.',
      });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('checks membership before Nothing to update (404 wins)', async () => {
      categoryIn();
      notMember();
      await expect(service.updateAsMember(5, 8, {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets a member change the emoji alone', async () => {
      categoryIn();
      repo.update.mockResolvedValue({ affected: 1 });
      await service.updateAsMember(5, 7, { emoji: '🍔' });
      expect(repo.update).toHaveBeenCalledWith(5, { name: undefined, emoji: '🍔' });
    });
  });

  describe('removeAsMember', () => {
    beforeEach(() => categoryIn());

    it('deletes when no bill or subscription uses it', async () => {
      bills.count.mockResolvedValue(0);
      subs.count.mockResolvedValue(0);
      repo.delete.mockResolvedValue({ affected: 1 });
      await expect(service.removeAsMember(5, 7)).resolves.toEqual({ affected: 1 });
      expect(accounts.assertMember).toHaveBeenCalledWith(3, 7);
      expect(bills.count).toHaveBeenCalledWith({ where: { category: { id: 5 } } });
      expect(subs.count).toHaveBeenCalledWith({ where: { category: { id: 5 } } });
      expect(repo.delete).toHaveBeenCalledWith(5);
    });

    it.each([[1, 0], [0, 2]])('gives 409 when bills=%i subscriptions=%i', async (b, s) => {
      bills.count.mockResolvedValue(b);
      subs.count.mockResolvedValue(s);
      await expect(service.removeAsMember(5, 7)).rejects.toBeInstanceOf(ConflictException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('gives 409 In use when a foreign-key error (1451) hits the delete', async () => {
      bills.count.mockResolvedValue(0);
      subs.count.mockResolvedValue(0);
      repo.delete.mockRejectedValue(Object.assign(new Error('fk'), { driverError: { errno: 1451 } }));
      await expect(service.removeAsMember(5, 7)).rejects.toMatchObject({ status: 409, message: 'In use' });
    });

    it('rethrows other delete errors', async () => {
      bills.count.mockResolvedValue(0);
      subs.count.mockResolvedValue(0);
      repo.delete.mockRejectedValue(new Error('boom'));
      await expect(service.removeAsMember(5, 7)).rejects.toThrow('boom');
    });

    it('gives 404 for a stranger without counting', async () => {
      notMember();
      await expect(service.removeAsMember(5, 8)).rejects.toBeInstanceOf(NotFoundException);
      expect(bills.count).not.toHaveBeenCalled();
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('gives 404 for a missing user', async () => {
      await expect(service.removeAsMember(5, undefined)).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });

  describe('copy', () => {
    const user = { id: 7 };
    beforeEach(() => {
      categoryIn(3);
      repo.find.mockResolvedValue([{ id: 40, name: 'Rent' }]);
      repo.save.mockResolvedValue({ id: 50 });
    });

    it('copies name and emoji into the target account and returns the new category with its account', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 5, name: 'Food', emoji: '🍕', account: { id: 3 } });
      repo.findOne.mockResolvedValueOnce({ id: 50, name: 'Food', account: { id: 9 } });
      await expect(service.copy(5, user, { account: { id: 9 } })).resolves.toEqual({ id: 50, name: 'Food', account: { id: 9 } });
      expect(accounts.assertMember).toHaveBeenCalledWith(3, 7);
      expect(accounts.assertMember).toHaveBeenCalledWith(9, 7);
      expect(repo.find).toHaveBeenCalledWith({ where: { account: { id: 9 } } });
      expect(repo.save).toHaveBeenCalledWith({ name: 'Food', emoji: '🍕', account: { id: 9 } });
    });

    it('gives 404 when the user is not a member of the target', async () => {
      accounts.assertMember.mockResolvedValueOnce({ id: 3 }).mockRejectedValueOnce(new NotFoundException());
      await expect(service.copy(5, user, { account: { id: 9 } })).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('gives 404 when the user is not a member of the source', async () => {
      notMember();
      await expect(service.copy(5, user, { account: { id: 9 } })).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('gives 404 for a source category without an account', async () => {
      repo.findOne.mockResolvedValue({ id: 5, name: 'Food', account: null });
      await expect(service.copy(5, user, { account: { id: 9 } })).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it.each([[undefined], [null], [9], ['9'], [{}]])('gives 400 Invalid account for target %j', async (account) => {
      await expect(service.copy(5, user, { account })).rejects.toMatchObject({ status: 400, message: 'Invalid account.' });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it.each([['Food'], ['food'], ['  FOOD  ']])('gives 409 Already exists when the target has %j (emoji ignored)', async (name) => {
      repo.find.mockResolvedValue([{ id: 40, name, emoji: '🍔' }]);
      await expect(service.copy(5, user, { account: { id: 9 } })).rejects.toMatchObject({ status: 409, message: 'Already exists' });
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
