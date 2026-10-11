import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AccountService } from '../account/account.service';
import { SubscriptionService } from './subscription.service';
import { Subscription } from './entities/subscription.entity';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  const accounts = { assertMember: jest.fn() };
  const repo = { save: jest.fn(), findOne: jest.fn(), update: jest.fn(), delete: jest.fn() };
  const creatorSub = { id: 4, user: { id: 7 }, account: { users: [{ id: 8 }] } };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [SubscriptionService, { provide: getRepositoryToken(Subscription), useValue: repo },
        { provide: AccountService, useValue: accounts },
      ],
    }).compile();
    service = module.get<SubscriptionService>(SubscriptionService);
  });

  it('getOwned works for the creator and for an account member', async () => {
    repo.findOne.mockResolvedValue(creatorSub);
    await expect(service.getOwned(4, 7)).resolves.toBe(creatorSub);
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { id: 4 },
      relations: expect.arrayContaining(['account.users']),
    });
    await expect(service.getOwned(4, 8)).resolves.toBe(creatorSub);
  });

  it('getOwned gives 404 for a stranger, a missing user and a missing subscription', async () => {
    repo.findOne.mockResolvedValue(creatorSub);
    await expect(service.getOwned(4, 9)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getOwned(4, undefined)).rejects.toBeInstanceOf(NotFoundException);
    repo.findOne.mockResolvedValue(null);
    await expect(service.getOwned(4, 7)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getOwned handles a subscription with no account', async () => {
    repo.findOne.mockResolvedValue({ id: 4, user: { id: 7 }, account: null });
    await expect(service.getOwned(4, 7)).resolves.toBeDefined();
    await expect(service.getOwned(4, 8)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateOwned writes only allow-listed fields that are present', async () => {
    repo.findOne.mockResolvedValue(creatorSub);
    repo.update.mockResolvedValue({ affected: 1 });
    const shop = { id: 1 };
    await service.updateOwned(4, 8, {
      id: 99,
      user: { id: 999 },
      shop,
      price: 5,
    } as any);
    expect(repo.update).toHaveBeenCalledWith(4, { shop, price: 5 });
  });

  it('updateOwned copies account when it is explicitly null', async () => {
    repo.findOne.mockResolvedValue(creatorSub);
    repo.update.mockResolvedValue({ affected: 1 });
    await service.updateOwned(4, 7, { account: null } as any);
    expect(repo.update).toHaveBeenCalledWith(4, { account: null });
  });

  it('updateOwned does not update when no allowed field is present', async () => {
    repo.findOne.mockResolvedValue(creatorSub);
    await service.updateOwned(4, 7, { id: 99, user: { id: 999 } } as any);
    await service.updateOwned(4, 7, {} as any);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('updateOwned and removeOwned give 404 for a stranger', async () => {
    repo.findOne.mockResolvedValue(creatorSub);
    await expect(service.updateOwned(4, 9, { price: 1 } as any)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.removeOwned(4, 9)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('removeOwned deletes for the creator and for a member', async () => {
    repo.findOne.mockResolvedValue(creatorSub);
    repo.delete.mockResolvedValue({ affected: 1 });
    await service.removeOwned(4, 7);
    await service.removeOwned(4, 8);
    expect(repo.delete).toHaveBeenCalledTimes(2);
    expect(repo.delete).toHaveBeenCalledWith(4);
  });

  it('updateOwned gives 404 for a non-member target account and writes nothing', async () => {
    repo.findOne.mockResolvedValue(creatorSub);
    accounts.assertMember.mockRejectedValue(new NotFoundException());
    await expect(service.updateOwned(4, 7, { account: { id: 77 } } as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(accounts.assertMember).toHaveBeenCalledWith(77, 7);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('updateOwned accepts a member target account', async () => {
    repo.findOne.mockResolvedValue(creatorSub);
    accounts.assertMember.mockResolvedValue({});
    await service.updateOwned(4, 7, { account: { id: 8 } } as any);
    expect(repo.update).toHaveBeenCalledWith(4, { account: { id: 8 } });
  });

  it('createOwned gives 404 for a non-member target account and saves nothing', async () => {
    accounts.assertMember.mockRejectedValue(new NotFoundException());
    await expect(service.createOwned(7, { account: { id: 77 } } as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('createOwned saves for a member account, a null account and no account', async () => {
    accounts.assertMember.mockResolvedValue({});
    repo.save.mockResolvedValue({ id: 1 });
    await service.createOwned(7, { account: { id: 8 } } as any);
    await service.createOwned(7, { account: null } as any);
    await service.createOwned(7, {} as any);
    expect(accounts.assertMember).toHaveBeenCalledTimes(1);
    expect(accounts.assertMember).toHaveBeenCalledWith(8, 7);
    expect(repo.save).toHaveBeenCalledTimes(3);
  });
});
