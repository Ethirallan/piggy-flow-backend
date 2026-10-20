import { Logger } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  createIntegrationModule,
  truncateTables,
  waitForLockWait,
} from '../../test/db.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { Bill } from '../bills/bill.entity.js';
import { BillsModule } from '../bills/bills.module.js';
import { CategoriesModule } from '../categories/categories.module.js';
import { ShopsModule } from '../shops/shops.module.js';
import { ShopsService } from '../shops/shops.service.js';
import { UsersService } from '../users/users.service.js';
import { SubscriptionChargerService } from './subscription-charger.service.js';
import { Subscription } from './subscription.entity.js';
import { SubscriptionsModule } from './subscriptions.module.js';
import { SubscriptionsService } from './subscriptions.service.js';

describe('SubscriptionChargerService (integration)', () => {
  let moduleRef: TestingModule;
  let charger: SubscriptionChargerService;
  let subscriptions: SubscriptionsService;
  let accounts: AccountsService;
  let shops: ShopsService;
  let users: UsersService;
  let dataSource: DataSource;

  const bills = () =>
    dataSource.getRepository(Bill).find({ order: { date: 'ASC' } });
  const setup = async (chargeDay: number, createdOn: string) => {
    const ana = await users.create({
      email: 'ana@example.com',
      displayName: 'Ana',
      passwordHash: 'hash',
    });
    const home = await accounts.create(ana.id, 'Home');
    const shop = await shops.create(home.id, ana.id, 'Netflix');
    const subscription = await subscriptions.create(
      ana.id,
      {
        accountId: home.id,
        priceCents: 1299,
        chargeDay,
        name: 'Streaming',
        shopId: shop.id,
      },
      createdOn,
    );
    return { ana, home, shop, subscription };
  };

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
    charger = moduleRef.get(SubscriptionChargerService);
    subscriptions = moduleRef.get(SubscriptionsService);
    accounts = moduleRef.get(AccountsService);
    shops = moduleRef.get(ShopsService);
    users = moduleRef.get(UsersService);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(() => moduleRef.close());

  beforeEach(() => truncateTables(dataSource));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates one bill per missed month, dated at local midnight, then nothing on a second run', async () => {
    const { home, shop, subscription } = await setup(15, '2026-07-10');

    expect(await charger.run('2026-10-20')).toBe(4);
    expect(await charger.run('2026-10-20')).toBe(0);

    const created = await bills();
    expect(created.map((b) => b.date.toISOString())).toEqual([
      '2026-07-14T22:00:00.000Z', // summer time, UTC+2
      '2026-08-14T22:00:00.000Z',
      '2026-09-14T22:00:00.000Z',
      '2026-10-14T22:00:00.000Z',
    ]);
    expect(created[0]).toMatchObject({
      accountId: home.id,
      priceCents: 1299,
      shopId: shop.id,
      categoryId: null,
      comment: 'Streaming',
      subscriptionId: subscription.id,
      createdById: null,
      updatedById: null,
    });
    await expect(
      dataSource
        .getRepository(Subscription)
        .findOneByOrFail({ id: subscription.id }),
    ).resolves.toMatchObject({ lastChargedMonth: '2026-10-01' });
  });

  it('dates winter charges at local midnight too, and the 31st on the last day', async () => {
    await setup(31, '2026-11-10');

    await charger.run('2027-03-01');

    expect((await bills()).map((b) => b.date.toISOString())).toEqual([
      '2026-11-29T23:00:00.000Z', // 30 Nov, UTC+1
      '2026-12-30T23:00:00.000Z',
      '2027-01-30T23:00:00.000Z',
      '2027-02-27T23:00:00.000Z',
    ]);
  });

  it('does not re-create a generated bill that was deleted', async () => {
    await setup(15, '2026-10-10');
    await charger.run('2026-10-20');
    const [bill] = await bills();
    await dataSource.getRepository(Bill).delete({ id: bill.id });

    expect(await charger.run('2026-10-25')).toBe(0);
    expect(await bills()).toEqual([]);
  });

  it('keeps charging the others when one subscription fails', async () => {
    const { ana } = await setup(15, '2026-10-10');
    const trip = await accounts.create(ana.id, 'Trip');
    await subscriptions.create(
      ana.id,
      { accountId: trip.id, priceCents: 500, chargeDay: 15 },
      '2026-10-10',
    );
    const transaction = vi.spyOn(dataSource, 'transaction');
    transaction.mockRejectedValueOnce(new Error('boom'));
    const logged = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    expect(await charger.run('2026-10-20')).toBe(1);
    expect(await bills()).toHaveLength(1);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('never charges a month twice when two runs overlap', async () => {
    const { subscription } = await setup(15, '2026-10-10');
    // Another run holds the subscription and is about to charge October.
    const other = dataSource.createQueryRunner();
    await other.connect();
    await other.startTransaction();
    let committed = false;
    try {
      await other.query(
        'SELECT id FROM subscriptions WHERE id = $1 FOR NO KEY UPDATE',
        [subscription.id],
      );
      const running = charger.run('2026-10-20');
      await waitForLockWait(dataSource);
      await other.query(
        `INSERT INTO bills (account_id, date, price_cents, subscription_id)
         SELECT account_id, now(), price_cents, id FROM subscriptions WHERE id = $1`,
        [subscription.id],
      );
      await other.query(
        "UPDATE subscriptions SET last_charged_month = '2026-10-01' WHERE id = $1",
        [subscription.id],
      );
      await other.commitTransaction();
      committed = true;

      expect(await running).toBe(0);
      expect(await bills()).toHaveLength(1);
    } finally {
      if (!committed) {
        await other.rollbackTransaction();
      }
      await other.release();
    }
  });

  it('only opens transactions for subscriptions with a due month', async () => {
    const { ana } = await setup(25, '2026-10-10');
    const trip = await accounts.create(ana.id, 'Trip');
    await subscriptions.create(
      ana.id,
      { accountId: trip.id, priceCents: 500, chargeDay: 25 },
      '2026-08-10',
    );
    const transaction = vi.spyOn(dataSource, 'transaction');

    // Home's day 25 is still ahead; Trip missed August and September.
    expect(await charger.run('2026-10-20')).toBe(2);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect((await bills()).map((b) => b.accountId)).toEqual([trip.id, trip.id]);
  });

  it.each([
    ['on its exact day', 20, '2026-10-10', '2026-10-20', 1],
    ['not the day before', 20, '2026-10-10', '2026-10-19', 0],
    ['the 31st on the 31st', 31, '2026-10-10', '2026-10-31', 1],
    [
      'the 31st not on the 30th of a 31-day month',
      31,
      '2026-10-10',
      '2026-10-30',
      0,
    ],
    [
      'the 31st on the 30th of a 30-day month',
      31,
      '2026-11-10',
      '2026-11-30',
      1,
    ],
    ['the 31st on 28 February', 31, '2027-02-10', '2027-02-28', 1],
  ])(
    'selects a subscription charged last month %s',
    async (_case, chargeDay, createdOn, today, expected) => {
      await setup(chargeDay, createdOn);

      expect(await charger.run(today)).toBe(expected);
    },
  );

  it('charges a subscription moved while it was being charged in its new account', async () => {
    const { ana, subscription } = await setup(15, '2026-10-10');
    const trip = await accounts.create(ana.id, 'Trip');
    // A PATCH holds the subscription and is moving it to Trip.
    const other = dataSource.createQueryRunner();
    await other.connect();
    await other.startTransaction();
    let committed = false;
    try {
      await other.query(
        'SELECT id FROM subscriptions WHERE id = $1 FOR NO KEY UPDATE',
        [subscription.id],
      );
      const running = charger.run('2026-10-20');
      await waitForLockWait(dataSource);
      await other.query(
        'UPDATE subscriptions SET account_id = $1, shop_id = NULL WHERE id = $2',
        [trip.id, subscription.id],
      );
      await other.commitTransaction();
      committed = true;

      expect(await running).toBe(1);
      expect(await bills()).toMatchObject([
        { accountId: trip.id, shopId: null },
      ]);
    } finally {
      if (!committed) {
        await other.rollbackTransaction();
      }
      await other.release();
    }
  });
});
