import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AccountService } from '../account/account.service';
import { PersonalAccountService } from '../account/personal-account.service';
import { SubscriptionService } from './subscription.service';
import { Subscription } from './entities/subscription.entity';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  const accounts = { assertMember: jest.fn() };
  const personal = { ensurePersonal: jest.fn() };
  const repo = { save: jest.fn(), findOne: jest.fn(), update: jest.fn(), delete: jest.fn(), find: jest.fn() };
  // Created by 7; 7 and 8 are members of its account 5.
  const creatorSub = { id: 4, user: { id: 7 }, account: { id: 5, users: [{ id: 7 }, { id: 8 }] } };
  /** Shop and category rows by id, as R2 loads them (with their account). */
  let lists: Record<string, { id: number; account: { id: number } }>;
  const manager = { findOne: jest.fn() };
  const R2 = new BadRequestException("Shop and category must be from the bill's account.");

  beforeEach(async () => {
    jest.resetAllMocks();
    lists = {
      'Shop:1': { id: 1, account: { id: 5 } },
      'Category:2': { id: 2, account: { id: 5 } },
      'Shop:21': { id: 21, account: { id: 4 } },
      'Shop:31': { id: 31, account: { id: 8 } },
      'Category:32': { id: 32, account: { id: 8 } },
    };
    manager.findOne.mockImplementation(async (entity, { where }) => lists[`${entity.name}:${where.id}`] ?? null);
    const module: TestingModule = await Test.createTestingModule({
      providers: [SubscriptionService, { provide: getRepositoryToken(Subscription), useValue: repo },
        { provide: AccountService, useValue: accounts },
        { provide: PersonalAccountService, useValue: personal },
        { provide: DataSource, useValue: { manager } },
      ],
    }).compile();
    service = module.get<SubscriptionService>(SubscriptionService);
  });

  it('getOwned works for every member of the account', async () => {
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

  it('getOwned gives 404 to the creator once they are not a member, and for no account', async () => {
    repo.findOne.mockResolvedValue({ id: 4, user: { id: 7 }, account: { id: 5, users: [{ id: 8 }] } });
    await expect(service.getOwned(4, 7)).rejects.toBeInstanceOf(NotFoundException);
    repo.findOne.mockResolvedValue({ id: 4, user: { id: 7 }, account: null });
    await expect(service.getOwned(4, 7)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getSubscriptionsByUserId lists the subscriptions of the user\'s accounts', async () => {
    repo.find.mockResolvedValue([{ id: 1 }]);
    await expect(service.getSubscriptionsByUserId(7)).resolves.toEqual([{ id: 1 }]);
    expect(repo.find).toHaveBeenCalledWith({
      where: { account: { users: { id: 7 } } },
      relations: ['user', 'account', 'shop', 'category'],
    });
  });

  describe('R2', () => {
    it('createOwned gives 400 for a shop from another account and saves nothing', async () => {
      accounts.assertMember.mockResolvedValue({});
      const dto: any = { user: { id: 7 }, account: { id: 5 }, shop: { id: 21 }, category: { id: 2 } };
      await expect(service.createOwned(7, dto)).rejects.toEqual(R2);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('createOwned checks a missing account against the Personal account', async () => {
      personal.ensurePersonal.mockResolvedValue({ id: 3 });
      const dto: any = { user: { id: 7 }, account: null, shop: { id: 1 }, category: { id: 2 } };
      await expect(service.createOwned(7, dto)).rejects.toEqual(R2);
      expect(repo.save).not.toHaveBeenCalled();
      lists['Shop:1'].account = { id: 3 };
      lists['Category:2'].account = { id: 3 };
      repo.save.mockResolvedValue({ id: 1 });
      await service.createOwned(7, { ...dto, account: undefined });
      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ account: { id: 3 } }));
    });

    it('createOwned gives 400 for a shop that does not exist', async () => {
      accounts.assertMember.mockResolvedValue({});
      const dto: any = { user: { id: 7 }, account: { id: 5 }, shop: { id: 999 }, category: { id: 2 } };
      await expect(service.createOwned(7, dto)).rejects.toEqual(R2);
    });

    it('updateOwned gives 400 when only the account changes and the shop is not in it', async () => {
      repo.findOne.mockResolvedValue({ ...creatorSub, shop: { id: 1 }, category: { id: 2 } });
      accounts.assertMember.mockResolvedValue({});
      await expect(service.updateOwned(4, 7, { account: { id: 8 } } as any)).rejects.toEqual(R2);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('updateOwned passes a valid change, and skips the check when no list field changes', async () => {
      repo.findOne.mockResolvedValue({ ...creatorSub, shop: { id: 1 }, category: { id: 2 } });
      accounts.assertMember.mockResolvedValue({});
      const dto = { account: { id: 8 }, shop: { id: 31 }, category: { id: 32 } };
      await service.updateOwned(4, 7, dto as any);
      expect(repo.update).toHaveBeenCalledWith(4, dto);
      manager.findOne.mockClear();
      await service.updateOwned(4, 7, { price: 2 } as any);
      expect(manager.findOne).not.toHaveBeenCalled();
    });
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

  it('updateOwned defaults an explicit null account to the creator\'s Personal account', async () => {
    repo.findOne.mockResolvedValue(creatorSub);
    repo.update.mockResolvedValue({ affected: 1 });
    personal.ensurePersonal.mockResolvedValue({ id: 3 });
    // A member (8) edits; the default is the creator's (7) Personal account.
    await service.updateOwned(4, 8, { account: null, price: 2 } as any);
    expect(personal.ensurePersonal).toHaveBeenCalledWith(7);
    expect(repo.update).toHaveBeenCalledWith(4, { account: { id: 3 }, price: 2 });
  });

  it('updateOwned leaves the account alone when the dto has no account', async () => {
    repo.findOne.mockResolvedValue(creatorSub);
    await service.updateOwned(4, 7, { price: 2 } as any);
    expect(personal.ensurePersonal).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith(4, { price: 2 });
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

  it('removeOwned deletes for every member', async () => {
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
    expect(personal.ensurePersonal).not.toHaveBeenCalled();
  });

  it('createOwned gives 404 for a non-member target account and saves nothing', async () => {
    accounts.assertMember.mockRejectedValue(new NotFoundException());
    await expect(service.createOwned(7, { account: { id: 77 } } as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('createOwned saves for a member account, a null account and no account', async () => {
    accounts.assertMember.mockResolvedValue({});
    repo.save.mockResolvedValue({ id: 1 });
    personal.ensurePersonal.mockResolvedValue({ id: 3 });
    const user = { id: 7 };
    await service.createOwned(7, { user, account: { id: 8 } } as any);
    expect(personal.ensurePersonal).not.toHaveBeenCalled();
    await service.createOwned(7, { user, account: null } as any);
    await service.createOwned(7, { user } as any);
    expect(accounts.assertMember).toHaveBeenCalledTimes(1);
    expect(accounts.assertMember).toHaveBeenCalledWith(8, 7);
    expect(personal.ensurePersonal).toHaveBeenCalledTimes(2);
    expect(personal.ensurePersonal).toHaveBeenCalledWith(7);
    expect(repo.save).toHaveBeenNthCalledWith(1, expect.objectContaining({ account: { id: 8 } }));
    expect(repo.save).toHaveBeenNthCalledWith(2, expect.objectContaining({ account: { id: 3 } }));
    expect(repo.save).toHaveBeenNthCalledWith(3, expect.objectContaining({ account: { id: 3 } }));
  });

  describe.each(['77', 77, [], {}])('a bare or malformed account %j', (account) => {
    it('updateOwned gives 400 and writes nothing', async () => {
      repo.findOne.mockResolvedValue(creatorSub);
      await expect(service.updateOwned(4, 7, { account } as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('createOwned gives 400 and saves nothing', async () => {
      await expect(service.createOwned(7, { account } as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  it('updateOwned accepts account null', async () => {
    repo.findOne.mockResolvedValue(creatorSub);
    personal.ensurePersonal.mockResolvedValue({ id: 3 });
    await service.updateOwned(4, 7, { account: null } as any);
    expect(repo.update).toHaveBeenCalledWith(4, { account: { id: 3 } });
    expect(accounts.assertMember).not.toHaveBeenCalled();
  });
});
