import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { DataSource, In } from 'typeorm';
import { AccountService } from '../account/account.service';
import { PersonalAccountService } from '../account/personal-account.service';
import { BillService } from './bill.service';
import { Bill } from './entities/bill.entity';
import { BillPhoto } from './entities/bill_photo.entity';
import { deletePhotoFiles, encodeImageToBlurhash } from './photo-files';

jest.mock('./photo-files', () => ({
  ...jest.requireActual('./photo-files'),
  deletePhotoFiles: jest.fn().mockResolvedValue(undefined),
  encodeImageToBlurhash: jest.fn(),
}));

describe('BillService', () => {
  let service: BillService;
  let bills: { findOne: jest.Mock; delete: jest.Mock };
  let photos: { count: jest.Mock };
  let manager: { update: jest.Mock; delete: jest.Mock; insert: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let accounts: { assertMember: jest.Mock };
  let personal: { ensurePersonal: jest.Mock };

  const bill = (over: any = {}) => ({
    id: 5,
    user: { id: 1 },
    account: { id: 9, users: [{ id: 2 }] },
    photos: [{ id: 1, path: 'a.jpg' }, { id: 2, path: 'b.png' }],
    ...over,
  });

  beforeEach(async () => {
    (deletePhotoFiles as jest.Mock).mockClear();
    (encodeImageToBlurhash as jest.Mock).mockReset();
    bills = {
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    } as any;
    photos = { count: jest.fn() };
    manager = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      insert: jest.fn().mockResolvedValue({}),
    };
    dataSource = { transaction: jest.fn((cb) => cb(manager)) };
    accounts = { assertMember: jest.fn().mockResolvedValue({}) };
    personal = { ensurePersonal: jest.fn().mockResolvedValue({ id: 3 }) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillService,
        { provide: getRepositoryToken(Bill), useValue: bills },
        { provide: getRepositoryToken(BillPhoto), useValue: photos },
        { provide: DataSource, useValue: dataSource },
        { provide: AccountService, useValue: accounts },
        { provide: PersonalAccountService, useValue: personal },
      ],
    }).compile();
    service = module.get<BillService>(BillService);
  });

  describe('create', () => {
    beforeEach(() => ((bills as any).save = jest.fn().mockResolvedValue({ id: 1 })));

    it.each([[null], [undefined]])('defaults account %j to the creator\'s Personal account', async (account) => {
      await service.create({ user: { id: 7 }, account, price: 1 } as any);
      expect(personal.ensurePersonal).toHaveBeenCalledWith(7);
      expect((bills as any).save).toHaveBeenCalledWith(expect.objectContaining({ account: { id: 3 }, price: 1 }));
    });

    it('keeps a given account', async () => {
      await service.create({ user: { id: 7 }, account: { id: 9 } } as any);
      expect(personal.ensurePersonal).not.toHaveBeenCalled();
      expect((bills as any).save).toHaveBeenCalledWith(expect.objectContaining({ account: { id: 9 } }));
    });
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

  describe('updateWithPhotos', () => {
    const file = (filename: string, originalname = 'IMG_1.JPG') =>
      ({ filename, originalname, path: `uploads/${filename}` } as Express.Multer.File);
    const fresh = { id: 5, photos: [] };

    beforeEach(() => {
      bills.findOne.mockResolvedValue(bill());
      (bills as any).findOneOrFail.mockResolvedValue(fresh);
      (encodeImageToBlurhash as jest.Mock).mockResolvedValue('LKO2?U%2Tw=w');
    });

    const deleteCalls = () => (deletePhotoFiles as jest.Mock).mock.calls;

    it('removes a photo row in the transaction, then deletes its file', async () => {
      await expect(service.updateWithPhotos(5, 1, { removePhotoIds: [2] }, [])).resolves.toBe(
        fresh,
      );
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.delete).toHaveBeenCalledWith(BillPhoto, { id: In([2]), bill: { id: 5 } });
      expect(manager.insert).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
      expect(deleteCalls()).toHaveLength(1);
      const [paths, isReferenced] = deleteCalls()[0];
      expect(paths).toEqual(['b.png']);
      photos.count.mockResolvedValue(1);
      await expect(isReferenced('b.png')).resolves.toBe(true);
      expect(photos.count).toHaveBeenCalledWith({ where: { path: 'b.png' } });
      expect(manager.delete.mock.invocationCallOrder[0]).toBeLessThan(
        (deletePhotoFiles as jest.Mock).mock.invocationCallOrder[0],
      );
      expect((bills as any).findOneOrFail).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 5 } }),
      );
    });

    it('inserts rows for new files with their blurhash', async () => {
      (encodeImageToBlurhash as jest.Mock)
        .mockResolvedValueOnce('hash1')
        .mockRejectedValueOnce(new Error('bad image'));
      const files = [file('n1.jpg'), file('n2.png', 'b.PNG')];
      await expect(service.updateWithPhotos(5, 2, {}, files)).resolves.toBe(fresh);
      expect(encodeImageToBlurhash).toHaveBeenCalledWith('uploads/n1.jpg');
      expect(manager.insert).toHaveBeenCalledWith(BillPhoto, [
        { name: 'IMG_1.JPG', path: 'n1.jpg', blurhash: 'hash1', bill: { id: 5 } },
        { name: 'b.PNG', path: 'n2.png', blurhash: '000000', bill: { id: 5 } },
      ]);
      expect(manager.delete).not.toHaveBeenCalled();
      // Blurhashes are computed before the transaction opens.
      expect((encodeImageToBlurhash as jest.Mock).mock.invocationCallOrder[1]).toBeLessThan(
        dataSource.transaction.mock.invocationCallOrder[0],
      );
      // Nothing was removed, so no removed-file cleanup deletes anything.
      for (const [paths] of deleteCalls()) expect(paths).toEqual([]);
    });

    it('adds, removes and updates fields together in one transaction', async () => {
      const dto = {
        comment: 'new',
        price: 12.5,
        removePhotoIds: [1, 2],
        user: { id: 99 },
        id: 77,
      } as any;
      await service.updateWithPhotos(5, 1, dto, [file('n1.jpg')]);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.update).toHaveBeenCalledWith(Bill, 5, { comment: 'new', price: 12.5 });
      expect(manager.delete).toHaveBeenCalledWith(BillPhoto, {
        id: In([1, 2]),
        bill: { id: 5 },
      });
      expect(manager.insert).toHaveBeenCalledWith(BillPhoto, [
        expect.objectContaining({ path: 'n1.jpg', bill: { id: 5 } }),
      ]);
      const removed = deleteCalls().find(([paths]) => paths.length > 0);
      expect(removed[0]).toEqual(['a.jpg', 'b.png']);
      expect(deleteCalls().flatMap(([paths]) => paths)).not.toContain('n1.jpg');
    });

    it('rejects an unknown photo id with 400 and deletes the new files', async () => {
      await expect(
        service.updateWithPhotos(5, 1, { removePhotoIds: [2, 42] }, [file('n1.jpg')]),
      ).rejects.toEqual(new BadRequestException('Unknown photo.'));
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(deleteCalls()).toHaveLength(1);
      const [paths, isReferenced] = deleteCalls()[0];
      expect(paths).toEqual(['n1.jpg']);
      await expect(isReferenced('n1.jpg')).resolves.toBe(false);
    });

    it('returns 404 for a non-member target account, writes nothing and deletes the new files', async () => {
      accounts.assertMember.mockRejectedValue(new NotFoundException());
      await expect(
        service.updateWithPhotos(5, 1, { account: { id: 77 } } as any, [file('n1.jpg')]),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(accounts.assertMember).toHaveBeenCalledWith(77, 1);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(deleteCalls()).toHaveLength(1);
      expect(deleteCalls()[0][0]).toEqual(['n1.jpg']);
    });

    it.each(['77', 77, [], {}])(
      'returns 400 for a malformed account %j, writes nothing and deletes the new files',
      async (account) => {
        await expect(
          service.updateWithPhotos(5, 1, { account } as any, [file('n1.jpg')]),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(dataSource.transaction).not.toHaveBeenCalled();
        expect(deleteCalls()[0][0]).toEqual(['n1.jpg']);
      },
    );

    it('updates to a member target account, and skips the check for account null', async () => {
      await service.updateWithPhotos(5, 1, { account: { id: 8 } } as any, []);
      expect(accounts.assertMember).toHaveBeenCalledWith(8, 1);
      expect(manager.update).toHaveBeenCalledWith(expect.anything(), 5, { account: { id: 8 } });
      expect(personal.ensurePersonal).not.toHaveBeenCalled();
      accounts.assertMember.mockClear();
      await service.updateWithPhotos(5, 1, { account: null } as any, []);
      expect(accounts.assertMember).not.toHaveBeenCalled();
    });

    it('defaults an explicit null account to the bill creator\'s Personal account', async () => {
      // Member 2 edits a bill created by user 1.
      await service.updateWithPhotos(5, 2, { account: null } as any, []);
      expect(personal.ensurePersonal).toHaveBeenCalledWith(1);
      expect(manager.update).toHaveBeenCalledWith(expect.anything(), 5, { account: { id: 3 } });
    });

    it('leaves the account alone when the dto has no account', async () => {
      await service.updateWithPhotos(5, 1, { price: 4 } as any, []);
      expect(personal.ensurePersonal).not.toHaveBeenCalled();
      expect(manager.update).toHaveBeenCalledWith(expect.anything(), 5, { price: 4 });
    });

    it('returns 404 for a stranger and deletes the new files', async () => {
      await expect(
        service.updateWithPhotos(5, 3, { removePhotoIds: [1] }, [file('n1.jpg'), file('n2.jpg')]),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(deleteCalls()).toHaveLength(1);
      expect(deleteCalls()[0][0]).toEqual(['n1.jpg', 'n2.jpg']);
    });

    it('when the transaction fails, deletes only the new files and rethrows', async () => {
      const failure = new Error('db down');
      manager.insert.mockRejectedValue(failure);
      photos.count.mockResolvedValue(0);
      await expect(
        service.updateWithPhotos(5, 1, { removePhotoIds: [1, 2] }, [file('n1.jpg')]),
      ).rejects.toBe(failure);
      const all = deleteCalls().flatMap(([paths]) => paths);
      expect(all).toEqual(['n1.jpg']);
      expect(all).not.toContain('a.jpg');
      expect(all).not.toContain('b.png');
      // The cleanup still checks the DB: an unreferenced new file is deletable.
      const [, isReferenced] = deleteCalls()[0];
      await expect(isReferenced('n1.jpg')).resolves.toBe(false);
      expect(photos.count).toHaveBeenCalledWith({ where: { path: 'n1.jpg' } });
      expect((bills as any).findOneOrFail).not.toHaveBeenCalled();
    });

    it('keeps new files whose rows were committed even though transaction() rejected', async () => {
      // e.g. the connection drops after COMMIT, or release() throws.
      dataSource.transaction.mockImplementation(async (cb) => {
        await cb(manager);
        throw new Error('release failed');
      });
      photos.count.mockResolvedValue(1);
      await expect(service.updateWithPhotos(5, 1, {}, [file('n1.jpg')])).rejects.toThrow(
        'release failed',
      );
      expect(deleteCalls()).toHaveLength(1);
      const [paths, isReferenced] = deleteCalls()[0];
      expect(paths).toEqual(['n1.jpg']);

      // Run the real deletion with the predicate the service passed.
      const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'committed-'));
      try {
        fs.writeFileSync(nodePath.join(root, 'n1.jpg'), 'x');
        const real = jest.requireActual('./photo-files').deletePhotoFiles;
        await real(paths, isReferenced, root, () => undefined);
        expect(fs.existsSync(nodePath.join(root, 'n1.jpg'))).toBe(true);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('does not delete removed files when the transaction itself rejects', async () => {
      dataSource.transaction.mockRejectedValue(new Error('commit failed'));
      await expect(
        service.updateWithPhotos(5, 1, { removePhotoIds: [1] }, []),
      ).rejects.toThrow('commit failed');
      expect(deleteCalls().flatMap(([paths]) => paths)).not.toContain('a.jpg');
    });

    it('keeps the new files once committed, even if reloading the bill fails', async () => {
      (bills as any).findOneOrFail.mockRejectedValue(new Error('gone'));
      await expect(service.updateWithPhotos(5, 1, {}, [file('n1.jpg')])).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(deleteCalls().flatMap(([paths]) => paths)).not.toContain('n1.jpg');
    });
  });
});
