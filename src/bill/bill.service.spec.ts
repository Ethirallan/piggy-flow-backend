import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { DataSource, In } from 'typeorm';
import { AccountService } from '../account/account.service';
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
  let dataSource: { transaction: jest.Mock; manager: { findOne: jest.Mock } };
  /** Shop and category rows by id, as R2 loads them (with their account). */
  let lists: Record<string, { id: number; account: { id: number } | null }>;
  let accounts: { assertMember: jest.Mock };

  const bill = (over: any = {}) => ({
    id: 5,
    user: { id: 1 },
    account: { id: 9, users: [{ id: 1 }, { id: 2 }] },
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
    lists = {};
    dataSource = {
      transaction: jest.fn((cb) => cb(manager)),
      manager: {
        findOne: jest.fn(async (entity, { where }) => lists[`${entity.name}:${where.id}`] ?? null),
      },
    };
    accounts = { assertMember: jest.fn().mockResolvedValue({}) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillService,
        { provide: getRepositoryToken(Bill), useValue: bills },
        { provide: getRepositoryToken(BillPhoto), useValue: photos },
        { provide: DataSource, useValue: dataSource },
        { provide: AccountService, useValue: accounts },
      ],
    }).compile();
    service = module.get<BillService>(BillService);
  });

  describe('create', () => {
    beforeEach(() => ((bills as any).save = jest.fn().mockResolvedValue({ id: 1 })));

    it('saves the dto as given, with no Personal default', async () => {
      const dto: any = { user: { id: 7 }, account: null, price: 1 };
      await service.create(dto);
      expect((bills as any).save).toHaveBeenCalledWith(dto);
      expect(dto.account).toBeNull();
    });

    it('creates a new bill for a client id pointing at someone else\'s bill, leaving it unchanged', async () => {
      // A tiny table that behaves like TypeORM save: an id updates that row, no id inserts.
      const victim = { id: 99, user: { id: 2 }, account: { id: 20 }, price: 50, comment: 'theirs' };
      const rows = new Map<number, any>([[99, { ...victim }]]);
      (bills as any).save = jest.fn(async (row: any) => {
        if (row.id != null && rows.has(row.id)) return Object.assign(rows.get(row.id), row);
        const created = { ...row, id: 100 };
        rows.set(100, created);
        return created;
      });
      const saved = await service.create({
        id: 99,
        user: { id: 7 },
        account: { id: 9 },
        price: 1,
        comment: 'mine',
        created: '2000-01-01',
        lastUpdate: '2000-01-01',
        photos: [{ id: 1, path: 'x.jpg' }],
      } as any);
      expect(saved.id).toBe(100);
      expect(rows.get(99)).toEqual(victim);
      const row = (bills as any).save.mock.calls[0][0];
      expect(row).not.toHaveProperty('id');
      expect(row).not.toHaveProperty('created');
      expect(row).not.toHaveProperty('lastUpdate');
      expect(row).not.toHaveProperty('photos');
      expect(row).toEqual({ user: { id: 7 }, account: { id: 9 }, price: 1, comment: 'mine' });
    });

    it('saves every field the subscription cron sets', async () => {
      const date = new Date();
      const dto = {
        user: { id: 7 },
        account: { id: 5 },
        shop: { id: 11 },
        category: { id: 12 },
        price: 3,
        comment: 'Netflix',
        date,
      };
      await service.create(dto as any);
      expect((bills as any).save).toHaveBeenCalledWith(dto);
    });
  });

  describe('getOwnedBill', () => {
    it('loads the bill with its relations and returns it for a member', async () => {
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

    it('throws NotFoundException for the creator once they are not a member of the bill account', async () => {
      bills.findOne.mockResolvedValue(bill({ account: { id: 9, users: [{ id: 2 }] } }));
      await expect(service.getOwnedBill(5, 1)).rejects.toBeInstanceOf(NotFoundException);
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

  describe('getBillsByUserId', () => {
    it('lists the bills of the accounts the user belongs to, not the bills they created', async () => {
      const calls: [string, any[]][] = [];
      const qb: any = new Proxy({}, {
        get: (_t, name: string) => (...args: any[]) => {
          calls.push([name, args]);
          return name === 'getMany' ? Promise.resolve([{ id: 1 }]) : qb;
        },
      });
      (bills as any).createQueryBuilder = jest.fn(() => qb);
      await expect(service.getBillsByUserId(7)).resolves.toEqual([{ id: 1 }]);
      expect(calls).toContainEqual([
        'innerJoin',
        ['account.users', 'member', 'member.id = :id', { id: 7 }],
      ]);
      const sql = JSON.stringify(calls);
      expect(sql).not.toContain('user.id');
      expect(sql).not.toContain('orWhere');
    });
  });

  describe('assertNewBill (R2 on create)', () => {
    const R2 = new BadRequestException("Shop and category must be from the bill's account.");
    beforeEach(() => {
      lists['Shop:11'] = { id: 11, account: { id: 9 } };
      lists['Category:12'] = { id: 12, account: { id: 9 } };
      lists['Shop:21'] = { id: 21, account: { id: 4 } };
      lists['Category:13'] = { id: 13, account: { id: 3 } };
    });

    it('lets a shop and category from the bill account through', async () => {
      const dto: any = { user: { id: 1 }, account: { id: 9 }, shop: { id: 11 }, category: { id: 12 } };
      await expect(service.assertNewBill(dto, 1)).resolves.toBeUndefined();
      expect(accounts.assertMember).toHaveBeenCalledWith(9, 1);
    });

    it('gives 400 for a shop from another account', async () => {
      const dto: any = { user: { id: 1 }, account: { id: 9 }, shop: { id: 21 }, category: { id: 12 } };
      await expect(service.assertNewBill(dto, 1)).rejects.toEqual(R2);
    });

    it.each([[null], [undefined]])('gives 400 Invalid account. without an account (%j), before R2', async (account) => {
      const dto: any = { user: { id: 1 }, account, shop: { id: 11 }, category: { id: 12 } };
      await expect(service.assertNewBill(dto, 1)).rejects.toEqual(new BadRequestException('Invalid account.'));
      expect(accounts.assertMember).not.toHaveBeenCalled();
      expect(dataSource.manager.findOne).not.toHaveBeenCalled();
    });

    it('gives 400 for a shop that does not exist or a malformed shop', async () => {
      for (const shop of [{ id: 999 }, 11, '11', { id: '11' }, []]) {
        const dto: any = { user: { id: 1 }, account: { id: 9 }, shop, category: { id: 12 } };
        await expect(service.assertNewBill(dto, 1)).rejects.toEqual(R2);
      }
    });

    it('checks the account reference before R2', async () => {
      accounts.assertMember.mockRejectedValue(new NotFoundException());
      const dto: any = { user: { id: 1 }, account: { id: 77 }, shop: { id: 11 } };
      await expect(service.assertNewBill(dto, 1)).rejects.toBeInstanceOf(NotFoundException);
      expect(dataSource.manager.findOne).not.toHaveBeenCalled();
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

    it('updates to a member target account', async () => {
      await service.updateWithPhotos(5, 1, { account: { id: 8 } } as any, []);
      expect(accounts.assertMember).toHaveBeenCalledWith(8, 1);
      expect(manager.update).toHaveBeenCalledWith(expect.anything(), 5, { account: { id: 8 } });
    });

    it('gives 400 Invalid account. for an explicit null account, writes nothing and deletes the new files', async () => {
      await expect(
        service.updateWithPhotos(5, 2, { account: null } as any, [file('n1.jpg')]),
      ).rejects.toEqual(new BadRequestException('Invalid account.'));
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(deleteCalls()[0][0]).toEqual(['n1.jpg']);
    });

    it('leaves the account alone when the dto has no account', async () => {
      await service.updateWithPhotos(5, 1, { price: 4 } as any, []);
      expect(accounts.assertMember).not.toHaveBeenCalled();
      expect(manager.update).toHaveBeenCalledWith(expect.anything(), 5, { price: 4 });
    });

    describe('R2', () => {
      const R2 = new BadRequestException("Shop and category must be from the bill's account.");
      beforeEach(() => {
        bills.findOne.mockResolvedValue(bill({ shop: { id: 11 }, category: { id: 12 } }));
        lists['Shop:11'] = { id: 11, account: { id: 9 } };
        lists['Category:12'] = { id: 12, account: { id: 9 } };
        lists['Shop:31'] = { id: 31, account: { id: 8 } };
        lists['Category:32'] = { id: 32, account: { id: 8 } };
      });

      it('gives 400 when only the account changes and the shop is not in the new account, and deletes the new uploads', async () => {
        await expect(
          service.updateWithPhotos(5, 1, { account: { id: 8 } } as any, [file('n1.jpg')]),
        ).rejects.toEqual(R2);
        expect(dataSource.transaction).not.toHaveBeenCalled();
        expect(encodeImageToBlurhash).not.toHaveBeenCalled();
        expect(deleteCalls()).toHaveLength(1);
        const [paths, isReferenced] = deleteCalls()[0];
        expect(paths).toEqual(['n1.jpg']);
        photos.count.mockResolvedValue(0);
        await expect(isReferenced('n1.jpg')).resolves.toBe(false);
      });

      it('gives 400 for a new shop from another account', async () => {
        await expect(
          service.updateWithPhotos(5, 1, { shop: { id: 31 } } as any, []),
        ).rejects.toEqual(R2);
        expect(dataSource.transaction).not.toHaveBeenCalled();
      });

      it('passes a valid change of account, shop and category', async () => {
        const dto = { account: { id: 8 }, shop: { id: 31 }, category: { id: 32 } } as any;
        await expect(service.updateWithPhotos(5, 1, dto, [])).resolves.toBe(fresh);
        expect(manager.update).toHaveBeenCalledWith(Bill, 5, dto);
      });

      it('allows clearing the shop and skips the check when no list field changes', async () => {
        await service.updateWithPhotos(5, 1, { comment: 'x' } as any, []);
        expect(dataSource.manager.findOne).not.toHaveBeenCalled();
        await service.updateWithPhotos(5, 1, { account: { id: 8 }, shop: null, category: { id: 32 } } as any, []);
        expect(manager.update).toHaveBeenLastCalledWith(Bill, 5, {
          account: { id: 8 },
          shop: null,
          category: { id: 32 },
        });
      });
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
