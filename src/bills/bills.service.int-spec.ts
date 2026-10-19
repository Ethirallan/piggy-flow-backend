import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { DataSource, QueryFailedError } from 'typeorm';
import { createIntegrationModule, truncateTables } from '../../test/db.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { CategoriesModule } from '../categories/categories.module.js';
import { CategoriesService } from '../categories/categories.service.js';
import { ShopsModule } from '../shops/shops.module.js';
import { ShopsService } from '../shops/shops.service.js';
import { UsersService } from '../users/users.service.js';
import { Bill, BILL_PRICE_CHECK } from './bill.entity.js';
import { BillsModule } from './bills.module.js';
import { BillsService } from './bills.service.js';

describe('BillsService (integration)', () => {
  let moduleRef: TestingModule;
  let bills: BillsService;
  let accounts: AccountsService;
  let shops: ShopsService;
  let categories: CategoriesService;
  let users: UsersService;
  let dataSource: DataSource;

  const createUser = (email = 'ana@example.com', displayName = 'Ana') =>
    users.create({ email, displayName, passwordHash: 'hash' });
  const billCount = () => dataSource.getRepository(Bill).count();
  const at = (iso: string) => new Date(iso);

  beforeAll(async () => {
    moduleRef = await createIntegrationModule({
      imports: [BillsModule, ShopsModule, CategoriesModule],
    });
    bills = moduleRef.get(BillsService);
    accounts = moduleRef.get(AccountsService);
    shops = moduleRef.get(ShopsService);
    categories = moduleRef.get(CategoriesService);
    users = moduleRef.get(UsersService);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(() => moduleRef.close());

  beforeEach(() => truncateTables(dataSource));

  describe('create and findForMember', () => {
    it('stores a bill with its shop, category, comment and creator', async () => {
      const ana = await createUser();
      const home = await accounts.create(ana.id, 'Home');
      const lidl = await shops.create(home.id, ana.id, 'Lidl');
      const food = await categories.create(home.id, ana.id, {
        name: 'Food',
        emoji: '🛒',
      });

      const bill = await bills.create(ana.id, {
        accountId: home.id,
        date: at('2026-10-16T11:26:00.000Z'),
        priceCents: -1250,
        shopId: lidl.id,
        categoryId: food.id,
        comment: '  weekly shop ',
      });

      expect(bill).toMatchObject({
        accountId: home.id,
        priceCents: -1250,
        comment: 'weekly shop',
        account: { name: 'Home' },
        shop: { name: 'Lidl' },
        category: { name: 'Food', emoji: '🛒' },
        createdBy: { id: ana.id, displayName: 'Ana' },
        updatedBy: { id: ana.id },
      });
      expect(bill.date.toISOString()).toBe('2026-10-16T11:26:00.000Z');
      await expect(bills.findForMember(bill.id, ana.id)).resolves.toMatchObject(
        { id: bill.id },
      );
    });

    it('stores a blank comment and missing shop and category as null', async () => {
      const ana = await createUser();
      const home = await accounts.create(ana.id, 'Home');

      const bill = await bills.create(ana.id, {
        accountId: home.id,
        date: at('2026-10-16T11:26:00.000Z'),
        priceCents: 100,
        comment: '   ',
      });

      expect(bill).toMatchObject({
        comment: null,
        shopId: null,
        shop: null,
        categoryId: null,
        category: null,
      });
    });

    it("answers 404 to a non-member, for the account and for the account's bills", async () => {
      const ana = await createUser('ana@example.com');
      const bob = await createUser('bob@example.com', 'Bob');
      const home = await accounts.create(ana.id, 'Home');
      const bill = await bills.create(ana.id, {
        accountId: home.id,
        date: at('2026-10-16T11:26:00.000Z'),
        priceCents: 100,
      });

      await expect(
        bills.create(bob.id, {
          accountId: home.id,
          date: at('2026-10-16T11:26:00.000Z'),
          priceCents: 100,
        }),
      ).rejects.toThrow(new NotFoundException('Account not found'));
      await expect(bills.findForMember(bill.id, bob.id)).rejects.toThrow(
        new NotFoundException('Bill not found'),
      );
      expect(await billCount()).toBe(1);
    });

    it('answers 400 for a shop or category from another account', async () => {
      const ana = await createUser();
      const home = await accounts.create(ana.id, 'Home');
      const trip = await accounts.create(ana.id, 'Trip');
      const tripShop = await shops.create(trip.id, ana.id, 'Spar');
      const tripCategory = await categories.create(trip.id, ana.id, {
        name: 'Food',
      });
      const base = {
        accountId: home.id,
        date: at('2026-10-16T11:26:00.000Z'),
        priceCents: 100,
      };

      await expect(
        bills.create(ana.id, { ...base, shopId: tripShop.id }),
      ).rejects.toThrow(new BadRequestException('Shop is not in this account'));
      await expect(
        bills.create(ana.id, { ...base, categoryId: tripCategory.id }),
      ).rejects.toThrow(
        new BadRequestException('Category is not in this account'),
      );
      expect(await billCount()).toBe(0);
    });

    it('lets the database reject a zero price', async () => {
      const ana = await createUser();
      const home = await accounts.create(ana.id, 'Home');

      const error: unknown = await dataSource
        .getRepository(Bill)
        .insert({
          accountId: home.id,
          date: at('2026-10-16T11:26:00.000Z'),
          priceCents: 0,
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(QueryFailedError);
      expect((error as QueryFailedError).driverError).toMatchObject({
        constraint: BILL_PRICE_CHECK,
      });
    });
  });

  describe('deleting what bills use', () => {
    const billIn = (userId: string, accountId: string, extra = {}) =>
      bills.create(userId, {
        accountId,
        date: at('2026-10-16T11:26:00.000Z'),
        priceCents: 100,
        ...extra,
      });

    it('answers 409 for an account, shop or category that bills use', async () => {
      const ana = await createUser();
      const home = await accounts.create(ana.id, 'Home');
      const lidl = await shops.create(home.id, ana.id, 'Lidl');
      const food = await categories.create(home.id, ana.id, { name: 'Food' });
      await billIn(ana.id, home.id, { shopId: lidl.id, categoryId: food.id });

      await expect(accounts.delete(home.id, ana.id)).rejects.toThrow(
        new ConflictException('Account still has bills'),
      );
      await expect(shops.delete(home.id, ana.id, lidl.id)).rejects.toThrow(
        new ConflictException('Shop is in use by bills'),
      );
      await expect(categories.delete(home.id, ana.id, food.id)).rejects.toThrow(
        new ConflictException('Category is in use by bills'),
      );
      expect(await billCount()).toBe(1);
    });

    it('answers 404, not 409, for a used shop of another account', async () => {
      const ana = await createUser();
      const home = await accounts.create(ana.id, 'Home');
      const trip = await accounts.create(ana.id, 'Trip');
      const spar = await shops.create(trip.id, ana.id, 'Spar');
      await billIn(ana.id, trip.id, { shopId: spar.id });

      await expect(shops.delete(home.id, ana.id, spar.id)).rejects.toThrow(
        new NotFoundException('Shop not found'),
      );
    });

    it('answers 201 or 404, never a database error, when the account is deleted during a create', async () => {
      // Several rounds, so the delete and the insert almost surely overlap.
      for (let round = 0; round < 10; round++) {
        await truncateTables(dataSource);
        const ana = await createUser();
        const home = await accounts.create(ana.id, 'Home');

        const [deleted, created] = await Promise.allSettled([
          accounts.delete(home.id, ana.id),
          billIn(ana.id, home.id),
        ]);

        if (created.status === 'fulfilled') {
          expect(deleted.status).toBe('rejected');
          expect((deleted as PromiseRejectedResult).reason).toEqual(
            new ConflictException('Account still has bills'),
          );
          expect(await billCount()).toBe(1);
        } else {
          expect(deleted.status).toBe('fulfilled');
          expect(created.reason).toEqual(
            new NotFoundException('Account not found'),
          );
          expect(await billCount()).toBe(0);
        }
      }
    });

    it('answers 201 or 400 for the bill and 204 or 409 for the shop, never a database error, when they race', async () => {
      for (let round = 0; round < 10; round++) {
        await truncateTables(dataSource);
        const ana = await createUser();
        const home = await accounts.create(ana.id, 'Home');
        const lidl = await shops.create(home.id, ana.id, 'Lidl');

        const [deleted, created] = await Promise.allSettled([
          shops.delete(home.id, ana.id, lidl.id),
          billIn(ana.id, home.id, { shopId: lidl.id }),
        ]);

        if (created.status === 'fulfilled') {
          expect(deleted.status).toBe('rejected');
          expect((deleted as PromiseRejectedResult).reason).toEqual(
            new ConflictException('Shop is in use by bills'),
          );
        } else {
          expect(deleted.status).toBe('fulfilled');
          expect(created.reason).toEqual(
            new BadRequestException('Shop is not in this account'),
          );
        }
      }
    });
  });
});
