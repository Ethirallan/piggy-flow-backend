import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { DataSource, QueryFailedError } from 'typeorm';
import {
  createIntegrationModule,
  truncateTables,
  waitForLockWait,
} from '../../test/db.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { CategoriesModule } from '../categories/categories.module.js';
import { CategoriesService } from '../categories/categories.service.js';
import { ShopsModule } from '../shops/shops.module.js';
import { ShopsService } from '../shops/shops.service.js';
import { UsersService } from '../users/users.service.js';
import { Bill, BILL_PRICE_CHECK } from './bill.entity.js';
import { encodeBillCursor } from './bill-cursor.js';
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

    it.each([
      {
        kind: 'shop',
        message: 'Shop is in use by bills',
        make: async (accountId: string, userId: string) => ({
          column: 'shopId',
          id: (await shops.create(accountId, userId, 'Lidl')).id,
        }),
        remove: (accountId: string, userId: string, id: string) =>
          shops.delete(accountId, userId, id),
      },
      {
        kind: 'category',
        message: 'Category is in use by bills',
        make: async (accountId: string, userId: string) => ({
          column: 'categoryId',
          id: (await categories.create(accountId, userId, { name: 'Food' })).id,
        }),
        remove: (accountId: string, userId: string, id: string) =>
          categories.delete(accountId, userId, id),
      },
    ])(
      'answers 409 for a $kind when a bill is saved after the usage check (foreign-key backstop)',
      async ({ message, make, remove }) => {
        await truncateTables(dataSource);
        const ana = await createUser();
        const home = await accounts.create(ana.id, 'Home');
        const used = await make(home.id, ana.id);

        // An uncommitted bill: hasBills can't see it, but its insert holds
        // FOR KEY SHARE on the row, so the delete blocks until the commit.
        const runner = dataSource.createQueryRunner();
        await runner.connect();
        await runner.startTransaction();
        let committed = false;
        try {
          await runner.manager.getRepository(Bill).insert({
            accountId: home.id,
            date: at('2026-10-16T11:26:00.000Z'),
            priceCents: 100,
            [used.column]: used.id,
          });
          const deleting = remove(home.id, ana.id, used.id).then(
            () => 'deleted',
            (error: unknown) => error,
          );
          await waitForLockWait(dataSource);
          await runner.commitTransaction();
          committed = true;

          const outcome = await deleting;
          expect(outcome).toEqual(new ConflictException(message));
          expect(await billCount()).toBe(1);
        } finally {
          if (!committed) await runner.rollbackTransaction();
          await runner.release();
        }
      },
    );
  });

  describe('list', () => {
    const seed = async () => {
      const ana = await createUser('ana@example.com');
      const bob = await createUser('bob@example.com', 'Bob');
      const home = await accounts.create(ana.id, 'Home');
      const trip = await accounts.create(ana.id, 'Trip');
      const bobs = await accounts.create(bob.id, 'Bob only');
      const add = (userId: string, accountId: string, iso: string) =>
        bills.create(userId, { accountId, date: at(iso), priceCents: 100 });
      const created = [
        await add(ana.id, home.id, '2026-09-30T21:59:59.999Z'), // Sep in UTC
        await add(ana.id, home.id, '2026-09-30T22:00:00.000Z'), // Oct 1 local
        await add(ana.id, trip.id, '2026-10-16T11:26:00.000Z'),
        await add(ana.id, home.id, '2026-10-16T11:26:00.000Z'), // same moment
        await add(ana.id, home.id, '2026-10-31T23:00:00.000Z'), // Nov 1 local
      ];
      await add(bob.id, bobs.id, '2026-10-10T10:00:00.000Z');
      return { ana, bob, home, trip, bobs, created };
    };
    /** Newest first, ties by id descending: the order the API promises. */
    const ordered = (rows: Bill[]) =>
      [...rows].sort(
        (a, b) => b.date.getTime() - a.date.getTime() || (a.id < b.id ? 1 : -1),
      );
    const ids = (rows: Bill[]) => rows.map((bill) => bill.id);

    it("lists the caller's bills from all their accounts, newest first", async () => {
      const { ana, created } = await seed();

      const page = await bills.list(ana.id, {});

      expect(ids(page.items)).toEqual(ids(ordered(created)));
      expect(page.nextCursor).toBeNull();
    });

    it('filters by account, and answers 404 for an account the caller is not in', async () => {
      const { ana, home, bobs, created } = await seed();

      const page = await bills.list(ana.id, { accountId: home.id });

      expect(ids(page.items)).toEqual(
        ids(ordered(created.filter((b) => b.accountId === home.id))),
      );
      await expect(bills.list(ana.id, { accountId: bobs.id })).rejects.toThrow(
        new NotFoundException('Account not found'),
      );
    });

    it('includes a bill exactly at from and excludes one exactly at to', async () => {
      const { ana, created } = await seed();

      const page = await bills.list(ana.id, {
        from: at('2026-10-01T00:00:00+02:00'),
        to: at('2026-11-01T00:00:00+01:00'),
      });

      expect(ids(page.items)).toEqual(
        ids(ordered([created[1], created[2], created[3]])),
      );
    });

    it('pages through bills that share a date without skipping or repeating', async () => {
      const { ana, created } = await seed();

      const seen: Bill[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await bills.list(ana.id, { limit: 2, cursor });
        seen.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        pages++;
      } while (cursor);

      expect(pages).toBe(3);
      expect(ids(seen)).toEqual(ids(ordered(created)));
    });

    it('returns the whole range with all, ignoring the limit', async () => {
      const { ana, created } = await seed();

      const page = await bills.list(ana.id, { all: true, limit: 2 });

      expect(page.items).toHaveLength(created.length);
      expect(page.nextCursor).toBeNull();
    });

    it.each([
      [
        'a cursor together with all',
        {
          all: true,
          cursor: encodeBillCursor({
            date: new Date('2026-10-16T11:26:00.000Z'),
            id: '3f2b8c1e-6c4a-4f7e-9a1d-2b5c8e9f0a1b',
          }),
        },
        "cursor can't be combined with all",
      ],
      [
        'from not before to',
        {
          from: at('2026-10-02T00:00:00Z'),
          to: at('2026-10-01T00:00:00Z'),
        },
        'from must be before to',
      ],
      ['a garbage cursor', { cursor: 'not-a-cursor' }, 'Invalid cursor'],
    ])('answers 400 for %s', async (_case, query, message) => {
      const ana = await createUser();

      await expect(bills.list(ana.id, query)).rejects.toThrow(
        new BadRequestException(message),
      );
    });
  });

  describe('update and delete', () => {
    const setup = async () => {
      const ana = await createUser('ana@example.com');
      const bob = await createUser('bob@example.com', 'Bob');
      const home = await accounts.create(ana.id, 'Home');
      const trip = await accounts.create(ana.id, 'Trip');
      const lidl = await shops.create(home.id, ana.id, 'Lidl');
      const spar = await shops.create(trip.id, ana.id, 'Spar');
      const bill = await bills.create(ana.id, {
        accountId: home.id,
        date: at('2026-10-16T11:26:00.000Z'),
        priceCents: 100,
        shopId: lidl.id,
        comment: 'weekly',
      });
      return { ana, bob, home, trip, lidl, spar, bill };
    };

    it('changes only the fields given, clears with null, and records who changed it', async () => {
      const { ana, bob, home, bill } = await setup();
      // Bob joins Home and edits Ana's bill.
      await dataSource.query(
        'INSERT INTO account_members (account_id, user_id) VALUES ($1, $2)',
        [home.id, bob.id],
      );

      const updated = await bills.update(bob.id, bill.id, {
        priceCents: -100,
        shopId: null,
        comment: null,
      });

      expect(updated).toMatchObject({
        priceCents: -100,
        shopId: null,
        comment: null,
        date: bill.date,
        createdBy: { id: ana.id },
        updatedBy: { id: bob.id },
      });
      expect(updated.updatedAt.getTime()).toBeGreaterThan(
        bill.updatedAt.getTime(),
      );
    });

    it('moves a bill to another account with a shop from that account', async () => {
      const { ana, trip, spar, bill } = await setup();

      const moved = await bills.update(ana.id, bill.id, {
        accountId: trip.id,
        shopId: spar.id,
      });

      expect(moved).toMatchObject({
        accountId: trip.id,
        shop: { name: 'Spar' },
      });
    });

    it('answers 400 when a move keeps a shop from the old account, and changes nothing', async () => {
      const { ana, home, trip, bill } = await setup();

      await expect(
        bills.update(ana.id, bill.id, { accountId: trip.id }),
      ).rejects.toThrow(new BadRequestException('Shop is not in this account'));
      await expect(bills.findForMember(bill.id, ana.id)).resolves.toMatchObject(
        { accountId: home.id, shop: { name: 'Lidl' } },
      );
    });

    it('answers 404 for a move into an account the caller is not in', async () => {
      const { ana, bob, bill } = await setup();
      const bobs = await accounts.create(bob.id, 'Bob only');

      await expect(
        bills.update(ana.id, bill.id, { accountId: bobs.id, shopId: null }),
      ).rejects.toThrow(new NotFoundException('Account not found'));
    });

    it('answers 400 for nothing to update, and 404 for a non-member', async () => {
      const { ana, bob, bill } = await setup();

      await expect(bills.update(ana.id, bill.id, {})).rejects.toThrow(
        new BadRequestException('Nothing to update'),
      );
      await expect(
        bills.update(bob.id, bill.id, { priceCents: 5 }),
      ).rejects.toThrow(new NotFoundException('Bill not found'));
      await expect(bills.delete(bob.id, bill.id)).rejects.toThrow(
        new NotFoundException('Bill not found'),
      );
    });

    it.each([
      {
        kind: 'shop',
        column: 'shop_id',
        key: 'shop',
        make: (accountId: string, userId: string) =>
          shops.create(accountId, userId, 'Lidl'),
      },
      {
        kind: 'category',
        column: 'category_id',
        key: 'category',
        make: (accountId: string, userId: string) =>
          categories.create(accountId, userId, { name: 'Lidl' }),
      },
    ])(
      'answers 404 when the kept $kind changed after it was read, instead of mixing accounts',
      async ({ column, key, make }) => {
        const ana = await createUser();
        const home = await accounts.create(ana.id, 'Home');
        const trip = await accounts.create(ana.id, 'Trip');
        const kept = await make(home.id, ana.id);
        const bill = await bills.create(ana.id, {
          accountId: home.id,
          date: at('2026-10-16T11:26:00.000Z'),
          priceCents: 100,
        });

        // An uncommitted change holds the row lock: the move reads no
        // shop/category, passes the check, and its UPDATE waits.
        const runner = dataSource.createQueryRunner();
        await runner.connect();
        await runner.startTransaction();
        let committed = false;
        try {
          await runner.query(`UPDATE bills SET ${column} = $1 WHERE id = $2`, [
            kept.id,
            bill.id,
          ]);
          const moving = bills
            .update(ana.id, bill.id, { accountId: trip.id })
            .then(
              () => 'updated',
              (error: unknown) => error,
            );
          await waitForLockWait(dataSource);
          await runner.commitTransaction();
          committed = true;

          expect(await moving).toEqual(new NotFoundException('Bill not found'));
          await expect(
            bills.findForMember(bill.id, ana.id),
          ).resolves.toMatchObject({
            accountId: home.id,
            [key]: { name: 'Lidl' },
          });
        } finally {
          if (!committed) await runner.rollbackTransaction();
          await runner.release();
        }
      },
    );

    it('deletes a bill; afterwards updating it answers 404 and re-creates nothing', async () => {
      const { ana, bill } = await setup();

      await bills.delete(ana.id, bill.id);

      await expect(
        bills.update(ana.id, bill.id, { priceCents: 5 }),
      ).rejects.toThrow(new NotFoundException('Bill not found'));
      expect(await billCount()).toBe(0);
    });
  });
});
