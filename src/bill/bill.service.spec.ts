import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BillService } from './bill.service';
import { Bill } from './entities/bill.entity';
import { BillPhoto } from './entities/bill_photo.entity';
import { deletePhotoFiles } from './photo-files';

jest.mock('./photo-files', () => ({
  ...jest.requireActual('./photo-files'),
  deletePhotoFiles: jest.fn().mockResolvedValue(undefined),
}));

describe('BillService', () => {
  let service: BillService;
  let bills: { findOne: jest.Mock; delete: jest.Mock };
  let photos: { count: jest.Mock };

  const bill = (over: any = {}) => ({
    id: 5,
    user: { id: 1 },
    account: { id: 9, users: [{ id: 2 }] },
    photos: [{ id: 1, path: 'a.jpg' }, { id: 2, path: 'b.png' }],
    ...over,
  });

  beforeEach(async () => {
    (deletePhotoFiles as jest.Mock).mockClear();
    bills = { findOne: jest.fn(), delete: jest.fn().mockResolvedValue({ affected: 1 }) };
    photos = { count: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillService,
        { provide: getRepositoryToken(Bill), useValue: bills },
        { provide: getRepositoryToken(BillPhoto), useValue: photos },
      ],
    }).compile();
    service = module.get<BillService>(BillService);
  });

  describe('getOwnedBill', () => {
    it('loads the bill with its relations and returns it for the creator', async () => {
      const b = bill();
      bills.findOne.mockResolvedValue(b);
      await expect(service.getOwnedBill(5, 1)).resolves.toBe(b);
      expect(bills.findOne).toHaveBeenCalledWith({
        where: { id: 5 },
        relations: ['user', 'account', 'account.users', 'shop', 'category', 'photos'],
      });
    });

    it('returns the bill for a member of the bill account', async () => {
      const b = bill();
      bills.findOne.mockResolvedValue(b);
      await expect(service.getOwnedBill(5, 2)).resolves.toBe(b);
    });

    it('throws NotFoundException for a stranger', async () => {
      bills.findOne.mockResolvedValue(bill());
      await expect(service.getOwnedBill(5, 3)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException for a bill without account or user', async () => {
      bills.findOne.mockResolvedValue(bill({ user: null, account: null }));
      await expect(service.getOwnedBill(5, 3)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException for a missing bill', async () => {
      bills.findOne.mockResolvedValue(null);
      await expect(service.getOwnedBill(5, 1)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when there is no user id', async () => {
      bills.findOne.mockResolvedValue(bill());
      await expect(service.getOwnedBill(5, undefined as any)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('isPhotoPathReferenced', () => {
    it('is true when a row references the path', async () => {
      photos.count.mockResolvedValue(1);
      await expect(service.isPhotoPathReferenced('a.jpg')).resolves.toBe(true);
      expect(photos.count).toHaveBeenCalledWith({ where: { path: 'a.jpg' } });
    });

    it('is false when none does', async () => {
      photos.count.mockResolvedValue(0);
      await expect(service.isPhotoPathReferenced('a.jpg')).resolves.toBe(false);
    });
  });

  describe('removeOwned', () => {
    it('deletes the bill, then its photo files', async () => {
      bills.findOne.mockResolvedValue(bill());
      const result = await service.removeOwned(5, 1);
      expect(result).toEqual({ affected: 1 });
      expect(bills.delete).toHaveBeenCalledWith(5);
      expect(deletePhotoFiles).toHaveBeenCalledTimes(1);
      const [paths, isReferenced] = (deletePhotoFiles as jest.Mock).mock.calls[0];
      expect(paths).toEqual(['a.jpg', 'b.png']);
      photos.count.mockResolvedValue(1);
      await expect(isReferenced('a.jpg')).resolves.toBe(true);
      expect(bills.delete.mock.invocationCallOrder[0]).toBeLessThan(
        (deletePhotoFiles as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it('returns 404 and deletes nothing for a stranger', async () => {
      bills.findOne.mockResolvedValue(bill());
      await expect(service.removeOwned(5, 3)).rejects.toBeInstanceOf(NotFoundException);
      expect(bills.delete).not.toHaveBeenCalled();
      expect(deletePhotoFiles).not.toHaveBeenCalled();
    });

    it('does not delete files when the bill delete fails', async () => {
      bills.findOne.mockResolvedValue(bill());
      bills.delete.mockRejectedValue(new Error('db'));
      await expect(service.removeOwned(5, 1)).rejects.toThrow('db');
      expect(deletePhotoFiles).not.toHaveBeenCalled();
    });
  });
});
