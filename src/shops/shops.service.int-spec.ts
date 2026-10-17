import { ConflictException, NotFoundException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { createIntegrationModule, truncateTables } from '../../test/db.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { UsersService } from '../users/users.service.js';
import { Shop } from './shop.entity.js';
import { ShopsModule } from './shops.module.js';
import { ShopsService } from './shops.service.js';

describe('ShopsService (integration)', () => {
  let moduleRef: TestingModule;
  let shops: ShopsService;
  let accounts: AccountsService;
  let users: UsersService;
  let dataSource: DataSource;

  const createUser = (email = 'ana@example.com') =>
    users.create({ email, displayName: 'Ana', passwordHash: 'hash' });
  const shopCount = () => dataSource.getRepository(Shop).count();

  beforeAll(async () => {
    moduleRef = await createIntegrationModule({ imports: [ShopsModule] });
    shops = moduleRef.get(ShopsService);
    accounts = moduleRef.get(AccountsService);
    users = moduleRef.get(UsersService);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(() => moduleRef.close());

  beforeEach(() => truncateTables(dataSource));

  it("lists only the account's shops, by name ignoring case", async () => {
    const ana = await createUser();
    const home = await accounts.create(ana.id, 'Home');
    const trip = await accounts.create(ana.id, 'Trip');
    await shops.create(home.id, ana.id, 'spar');
    await shops.create(home.id, ana.id, 'Hofer');
    await shops.create(trip.id, ana.id, 'Lidl');

    const list = await shops.list(home.id, ana.id);

    expect(list.map((s) => s.name)).toEqual(['Hofer', 'spar']);
  });

  it('answers 404 to a non-member and creates nothing', async () => {
    const ana = await createUser('ana@example.com');
    const bob = await createUser('bob@example.com');
    const home = await accounts.create(ana.id, 'Home');

    await expect(shops.list(home.id, bob.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(shops.create(home.id, bob.id, 'Lidl')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await shopCount()).toBe(0);
  });

  it('rejects a name the account already has in any case, but not in another account', async () => {
    const ana = await createUser();
    const home = await accounts.create(ana.id, 'Home');
    const trip = await accounts.create(ana.id, 'Trip');
    await shops.create(home.id, ana.id, 'Lidl');

    await expect(shops.create(home.id, ana.id, 'LIDL')).rejects.toThrow(
      new ConflictException('A shop with that name already exists'),
    );
    await expect(shops.create(trip.id, ana.id, 'LIDL')).resolves.toMatchObject({
      name: 'LIDL',
    });
  });

  it('deletes the shops with their account', async () => {
    const ana = await createUser();
    const home = await accounts.create(ana.id, 'Home');
    await shops.create(home.id, ana.id, 'Lidl');

    await accounts.delete(home.id, ana.id);

    expect(await shopCount()).toBe(0);
  });

  it('answers 409, never a database error, when the same name is added twice at once', async () => {
    // Several rounds, so the two inserts almost surely overlap.
    for (let round = 0; round < 10; round++) {
      await truncateTables(dataSource);
      const ana = await createUser();
      const home = await accounts.create(ana.id, 'Home');

      const results = await Promise.allSettled([
        shops.create(home.id, ana.id, 'Lidl'),
        shops.create(home.id, ana.id, 'lidl'),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const rejected = results.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(rejected?.reason).toBeInstanceOf(ConflictException);
    }
  });

  it('answers 404, never a database error, when the account is deleted during a create', async () => {
    for (let round = 0; round < 10; round++) {
      await truncateTables(dataSource);
      const ana = await createUser();
      const home = await accounts.create(ana.id, 'Home');

      const [deleted, created] = await Promise.allSettled([
        accounts.delete(home.id, ana.id),
        shops.create(home.id, ana.id, 'Lidl'),
      ]);

      expect(deleted.status).toBe('fulfilled');
      if (created.status === 'rejected') {
        expect(created.reason).toBeInstanceOf(NotFoundException);
      }
      expect(await shopCount()).toBe(0);
    }
  });
});
