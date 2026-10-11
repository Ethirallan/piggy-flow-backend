import { ConflictException, NotFoundException } from '@nestjs/common';
import { PersonalAccountService } from 'src/account/personal-account.service';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Bill } from 'src/bill/entities/bill.entity';
import { Subscription } from 'src/subscription/entities/subscription.entity';
import { ShopService } from './shop.service';
import { Shop } from './entities/shop.entity';

describe('ShopService', () => {
  let service: ShopService;
  const repo = { findOne: jest.fn(), update: jest.fn(), delete: jest.fn(), save: jest.fn() };
  const personal = { ensurePersonal: jest.fn() };
  const bills = { count: jest.fn() };
  const subs = { count: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopService,
        { provide: getRepositoryToken(Shop), useValue: repo },
        { provide: getRepositoryToken(Bill), useValue: bills },
        { provide: getRepositoryToken(Subscription), useValue: subs },
        { provide: PersonalAccountService, useValue: personal },
      ],
    }).compile();
    service = module.get<ShopService>(ShopService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it.each([[undefined], [null], [{ id: 77 }]])(
      'saves into the creator\'s Personal account (body account %j ignored)',
      async (account) => {
        personal.ensurePersonal.mockResolvedValue({ id: 3 });
        repo.save.mockResolvedValue({ id: 1 });
        await service.create({ name: 'x', user: { id: 7 }, account } as any);
        expect(personal.ensurePersonal).toHaveBeenCalledWith(7);
        expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'x', account: { id: 3 } }));
      },
    );

    it('gives 404 without a user and saves nothing', async () => {
      await expect(service.create({ name: 'x', user: null } as any)).rejects.toBeInstanceOf(NotFoundException);
      expect(personal.ensurePersonal).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('getOwned', () => {
    it('returns the shop for its owner', async () => {
      repo.findOne.mockResolvedValue({ id: 5 });
      await expect(service.getOwned(5, 7)).resolves.toEqual({ id: 5 });
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 5, user: { id: 7 } } });
    });

    it('gives 404 for another user or a missing shop', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.getOwned(5, 8)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('gives 404 for an undefined user id without querying', async () => {
      await expect(service.getOwned(5, undefined)).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('updateOwned', () => {
    it('passes only the editable fields', async () => {
      repo.findOne.mockResolvedValue({ id: 5 });
      repo.update.mockResolvedValue({ affected: 1 });
      const dto: any = { name: 'Lidl', user: { id: 99 }, id: 99 };
      await service.updateOwned(5, 7, dto);
      expect(repo.update).toHaveBeenCalledWith(5, { name: 'Lidl' });
    });

    it('gives 404 for a stranger without updating', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.updateOwned(5, 8, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('removeOwned', () => {
    beforeEach(() => repo.findOne.mockResolvedValue({ id: 5 }));

    it('deletes when no bill or subscription uses it', async () => {
      bills.count.mockResolvedValue(0);
      subs.count.mockResolvedValue(0);
      repo.delete.mockResolvedValue({ affected: 1 });
      await expect(service.removeOwned(5, 7)).resolves.toEqual({ affected: 1 });
      expect(bills.count).toHaveBeenCalledWith({ where: { shop: { id: 5 } } });
      expect(subs.count).toHaveBeenCalledWith({ where: { shop: { id: 5 } } });
      expect(repo.delete).toHaveBeenCalledWith(5);
    });

    it.each([[1, 0], [0, 2]])('gives 409 when bills=%i subscriptions=%i', async (b, s) => {
      bills.count.mockResolvedValue(b);
      subs.count.mockResolvedValue(s);
      await expect(service.removeOwned(5, 7)).rejects.toBeInstanceOf(ConflictException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('gives 404 for a stranger without counting', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.removeOwned(5, 8)).rejects.toBeInstanceOf(NotFoundException);
      expect(bills.count).not.toHaveBeenCalled();
      expect(subs.count).not.toHaveBeenCalled();
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });
});
