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
import { Bill } from '../bills/bill.entity.js';
import { BillsModule } from '../bills/bills.module.js';
import { CategoriesModule } from '../categories/categories.module.js';
import { CategoriesService } from '../categories/categories.service.js';
import { ShopsModule } from '../shops/shops.module.js';
import { ShopsService } from '../shops/shops.service.js';
import { UsersService } from '../users/users.service.js';
import { SubscriptionChargerService } from './subscription-charger.service.js';
import {
  Subscription,
  SUBSCRIPTION_PRICE_CHECK,
} from './subscription.entity.js';
import { SubscriptionsModule } from './subscriptions.module.js';
import { SubscriptionsService } from './subscriptions.service.js';

describe('SubscriptionsService (integration)', () => {
  let moduleRef: TestingModule;
  let subscriptions: SubscriptionsService;
  let accounts: AccountsService;
  let shops: ShopsService;
  let categories: CategoriesService;
  let charger: SubscriptionChargerService;
  let users: UsersService;
  let dataSource: DataSource;

  const createUser = (email = 'ana@example.com', displayName = 'Ana') =>
    users.create({ email, displayName, passwordHash: 'hash' });
  const count = () => dataSource.getRepository(Subscription).count();

  beforeAll(async () => {
    moduleRef = await createIntegrationModule({
      imports: [
        SubscriptionsModule,
        BillsModule,
        ShopsModule,
        CategoriesModule,
      ],
    });
    await moduleRef.init();
    subscriptions = moduleRef.get(SubscriptionsService);
    accounts = moduleRef.get(AccountsService);
    shops = moduleRef.get(ShopsService);
    categories = moduleRef.get(CategoriesService);
    charger = moduleRef.get(SubscriptionChargerService);
    users = moduleRef.get(UsersService);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(() => moduleRef.close());

  beforeEach(() => truncateTables(dataSource));

  it('stores a subscription with its first charge month and creator', async () => {
    const ana = await createUser();
    const home = await accounts.create(ana.id, 'Home');
    const netflix = await shops.create(home.id, ana.id, 'Netflix');

    const created = await subscriptions.create(
      ana.id,
      {
        accountId: home.id,
        priceCents: 1299,
        chargeDay: 25,
        name: '  Streaming ',
        shopId: netflix.id,
      },
      '2026-10-20',
    );

    expect(created).toMatchObject({
      name: 'Streaming',
      priceCents: 1299,
      chargeDay: 25,
      lastChargedMonth: '2026-09-01',
      account: { name: 'Home' },
      shop: { name: 'Netflix' },
      category: null,
      createdBy: { id: ana.id, displayName: 'Ana' },
    });
    expect(created.createdBy?.passwordHash).toBeUndefined();
  });

  it('starts next month when the charge day has passed', async () => {
    const ana = await createUser();
    const home = await accounts.create(ana.id, 'Home');

    const created = await subscriptions.create(
      ana.id,
      { accountId: home.id, priceCents: 500, chargeDay: 5, name: '' },
      '2026-10-20',
    );

    expect(created).toMatchObject({
      name: null,
      lastChargedMonth: '2026-10-01',
    });
  });

  it('answers 404 to a non-member and 400 for a shop of another account', async () => {
    const ana = await createUser('ana@example.com');
    const bob = await createUser('bob@example.com', 'Bob');
    const home = await accounts.create(ana.id, 'Home');
    const trip = await accounts.create(ana.id, 'Trip');
    const spar = await shops.create(trip.id, ana.id, 'Spar');
    const mine = await subscriptions.create(ana.id, {
      accountId: home.id,
      priceCents: 100,
      chargeDay: 1,
    });

    await expect(
      subscriptions.create(bob.id, {
        accountId: home.id,
        priceCents: 100,
        chargeDay: 1,
      }),
    ).rejects.toThrow(new NotFoundException('Account not found'));
    await expect(subscriptions.findForMember(mine.id, bob.id)).rejects.toThrow(
      new NotFoundException('Subscription not found'),
    );
    await expect(
      subscriptions.create(ana.id, {
        accountId: home.id,
        priceCents: 100,
        chargeDay: 1,
        shopId: spar.id,
      }),
    ).rejects.toThrow(new BadRequestException('Shop is not in this account'));
    expect(await count()).toBe(1);
  });

  it('lets the database reject a zero price', async () => {
    const ana = await createUser();
    const home = await accounts.create(ana.id, 'Home');

    const error: unknown = await dataSource
      .getRepository(Subscription)
      .insert({
        accountId: home.id,
        priceCents: 0,
        chargeDay: 1,
        lastChargedMonth: '2026-09-01',
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(QueryFailedError);
    expect((error as QueryFailedError).driverError).toMatchObject({
      constraint: SUBSCRIPTION_PRICE_CHECK,
    });
  });

  describe('list, update and delete', () => {
    it('lists the caller’s subscriptions by next charge date, then name', async () => {
      const ana = await createUser();
      const home = await accounts.create(ana.id, 'Home');
      const trip = await accounts.create(ana.id, 'Trip');
      const add = (accountId: string, chargeDay: number, name: string) =>
        subscriptions.create(
          ana.id,
          { accountId, priceCents: 100, chargeDay, name },
          '2026-10-20',
        );
      await add(home.id, 25, 'Rent');
      await add(trip.id, 5, 'Phone');
      await add(home.id, 25, 'Internet');

      expect((await subscriptions.list(ana.id)).map((s) => s.name)).toEqual([
        'Internet',
        'Rent',
        'Phone',
      ]);
      expect(
        (await subscriptions.list(ana.id, trip.id)).map((s) => s.name),
      ).toEqual(['Phone']);
    });

    it('moves the first charge when the day changes before this month was charged', async () => {
      const ana = await createUser();
      const home = await accounts.create(ana.id, 'Home');
      const sub = await subscriptions.create(
        ana.id,
        { accountId: home.id, priceCents: 100, chargeDay: 25 },
        '2026-10-20',
      );

      const updated = await subscriptions.update(
        ana.id,
        sub.id,
        { chargeDay: 5, priceCents: 200, name: null },
        '2026-10-20',
      );

      expect(updated).toMatchObject({
        chargeDay: 5,
        priceCents: 200,
        name: null,
        lastChargedMonth: '2026-10-01',
        updatedBy: { id: ana.id },
      });
    });

    it('answers 400 for nothing to update and when a move keeps a shop of the old account', async () => {
      const ana = await createUser();
      const home = await accounts.create(ana.id, 'Home');
      const trip = await accounts.create(ana.id, 'Trip');
      const lidl = await shops.create(home.id, ana.id, 'Lidl');
      const sub = await subscriptions.create(ana.id, {
        accountId: home.id,
        priceCents: 100,
        chargeDay: 1,
        shopId: lidl.id,
      });

      await expect(subscriptions.update(ana.id, sub.id, {})).rejects.toThrow(
        new BadRequestException('Nothing to update'),
      );
      await expect(
        subscriptions.update(ana.id, sub.id, { accountId: trip.id }),
      ).rejects.toThrow(new BadRequestException('Shop is not in this account'));
    });

    it('deletes a subscription; another member can, a non-member gets 404', async () => {
      const ana = await createUser('ana@example.com');
      const bob = await createUser('bob@example.com', 'Bob');
      const home = await accounts.create(ana.id, 'Home');
      const sub = await subscriptions.create(ana.id, {
        accountId: home.id,
        priceCents: 100,
        chargeDay: 1,
      });

      await expect(subscriptions.delete(bob.id, sub.id)).rejects.toThrow(
        new NotFoundException('Subscription not found'),
      );
      await subscriptions.delete(ana.id, sub.id);
      expect(await count()).toBe(0);
    });
  });

  describe('deleting what subscriptions use', () => {
    it('answers 409 for a shop or category a subscription uses', async () => {
      const ana = await createUser();
      const home = await accounts.create(ana.id, 'Home');
      const netflix = await shops.create(home.id, ana.id, 'Netflix');
      const fun = await categories.create(home.id, ana.id, { name: 'Fun' });
      await subscriptions.create(ana.id, {
        accountId: home.id,
        priceCents: 1299,
        chargeDay: 1,
        shopId: netflix.id,
        categoryId: fun.id,
      });

      await expect(shops.delete(home.id, ana.id, netflix.id)).rejects.toThrow(
        new ConflictException('Shop is in use by subscriptions'),
      );
      await expect(categories.delete(home.id, ana.id, fun.id)).rejects.toThrow(
        new ConflictException('Category is in use by subscriptions'),
      );
      expect(await shops.list(home.id, ana.id)).toHaveLength(1);
      expect(await categories.list(home.id, ana.id)).toHaveLength(1);
    });

    it.each([
      {
        kind: 'shop',
        column: 'shop_id',
        message: 'Shop is in use by subscriptions',
        make: async (accountId: string, userId: string) =>
          (await shops.create(accountId, userId, 'Netflix')).id,
        remove: (accountId: string, userId: string, id: string) =>
          shops.delete(accountId, userId, id),
      },
      {
        kind: 'category',
        column: 'category_id',
        message: 'Category is in use by subscriptions',
        make: async (accountId: string, userId: string) =>
          (await categories.create(accountId, userId, { name: 'Fun' })).id,
        remove: (accountId: string, userId: string, id: string) =>
          categories.delete(accountId, userId, id),
      },
    ])(
      'answers 409 for a $kind through the foreign key when a subscription is saved during the delete',
      async ({ column, message, make, remove }) => {
        const ana = await createUser();
        const home = await accounts.create(ana.id, 'Home');
        const usedId = await make(home.id, ana.id);

        // An uncommitted subscription: the usage check can't see it, but its
        // insert holds FOR KEY SHARE on the row, so the delete blocks until
        // the commit and then trips the RESTRICT foreign key.
        const runner = dataSource.createQueryRunner();
        await runner.connect();
        await runner.startTransaction();
        let committed = false;
        try {
          await runner.manager.query(
            `INSERT INTO subscriptions (account_id, price_cents, charge_day, last_charged_month, ${column})
             VALUES ($1, 100, 1, '2026-09-01', $2)`,
            [home.id, usedId],
          );
          const deleting = remove(home.id, ana.id, usedId).then(
            () => 'deleted',
            (error: unknown) => error,
          );
          await waitForLockWait(dataSource);
          await runner.commitTransaction();
          committed = true;

          expect(await deleting).toEqual(new ConflictException(message));
          expect(await count()).toBe(1);
        } finally {
          if (!committed) await runner.rollbackTransaction();
          await runner.release();
        }
      },
    );

    it('deletes an account’s subscriptions with the account', async () => {
      const ana = await createUser();
      const home = await accounts.create(ana.id, 'Home');
      await subscriptions.create(ana.id, {
        accountId: home.id,
        priceCents: 100,
        chargeDay: 1,
      });

      await expect(accounts.delete(home.id, ana.id)).resolves.toBeUndefined();
      expect(await count()).toBe(0);
    });

    it('keeps the bills when a subscription is deleted', async () => {
      const ana = await createUser();
      const home = await accounts.create(ana.id, 'Home');
      const sub = await subscriptions.create(
        ana.id,
        { accountId: home.id, priceCents: 1299, chargeDay: 25 },
        '2026-09-20',
      );
      expect(await charger.run('2026-09-25')).toBe(1);
      const [charged] = await dataSource.getRepository(Bill).find();
      expect(charged.subscriptionId).toBe(sub.id);

      await subscriptions.delete(ana.id, sub.id);

      expect(await dataSource.getRepository(Bill).find()).toEqual([
        expect.objectContaining({
          id: charged.id,
          priceCents: 1299,
          subscriptionId: null,
        }),
      ]);
    });

    it('does not deadlock when an account is deleted while it is being charged', async () => {
      const ana = await createUser();
      const home = await accounts.create(ana.id, 'Home');
      const sub = await subscriptions.create(
        ana.id,
        { accountId: home.id, priceCents: 1299, chargeDay: 25 },
        '2026-09-20',
      );

      // The charger's locks, in its order: account, then subscription.
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      let committed = false;
      try {
        await runner.manager.query(
          'SELECT 1 FROM accounts WHERE id = $1 FOR KEY SHARE',
          [home.id],
        );
        await runner.manager.query(
          'SELECT 1 FROM subscriptions WHERE id = $1 FOR NO KEY UPDATE',
          [sub.id],
        );
        const deleting = accounts.delete(home.id, ana.id).then(
          () => 'deleted',
          (error: unknown) => error,
        );
        await waitForLockWait(dataSource);
        await runner.manager.getRepository(Bill).insert({
          accountId: home.id,
          date: new Date('2026-09-24T22:00:00.000Z'),
          priceCents: 1299,
          subscriptionId: sub.id,
        });
        await runner.commitTransaction();
        committed = true;

        expect(await deleting).toEqual(
          new ConflictException('Account still has bills'),
        );
        expect(await count()).toBe(1);
      } finally {
        if (!committed) await runner.rollbackTransaction();
        await runner.release();
      }
    });
  });
});
