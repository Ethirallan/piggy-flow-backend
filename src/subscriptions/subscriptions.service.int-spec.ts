import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { DataSource, QueryFailedError } from 'typeorm';
import { createIntegrationModule, truncateTables } from '../../test/db.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { CategoriesModule } from '../categories/categories.module.js';
import { ShopsModule } from '../shops/shops.module.js';
import { ShopsService } from '../shops/shops.service.js';
import { UsersService } from '../users/users.service.js';
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
  let users: UsersService;
  let dataSource: DataSource;

  const createUser = (email = 'ana@example.com', displayName = 'Ana') =>
    users.create({ email, displayName, passwordHash: 'hash' });
  const count = () => dataSource.getRepository(Subscription).count();

  beforeAll(async () => {
    moduleRef = await createIntegrationModule({
      imports: [SubscriptionsModule, ShopsModule, CategoriesModule],
    });
    await moduleRef.init();
    subscriptions = moduleRef.get(SubscriptionsService);
    accounts = moduleRef.get(AccountsService);
    shops = moduleRef.get(ShopsService);
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
});
