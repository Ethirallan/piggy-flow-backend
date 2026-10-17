import { ConflictException, NotFoundException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { createIntegrationModule, truncateTables } from '../../test/db.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { UsersService } from '../users/users.service.js';
import { Category } from './category.entity.js';
import { CategoriesModule } from './categories.module.js';
import { CategoriesService } from './categories.service.js';

describe('CategoriesService (integration)', () => {
  let moduleRef: TestingModule;
  let categories: CategoriesService;
  let accounts: AccountsService;
  let users: UsersService;
  let dataSource: DataSource;

  const createUser = (email = 'ana@example.com') =>
    users.create({ email, displayName: 'Ana', passwordHash: 'hash' });
  const categoryCount = () => dataSource.getRepository(Category).count();

  beforeAll(async () => {
    moduleRef = await createIntegrationModule({ imports: [CategoriesModule] });
    categories = moduleRef.get(CategoriesService);
    accounts = moduleRef.get(AccountsService);
    users = moduleRef.get(UsersService);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(() => moduleRef.close());

  beforeEach(() => truncateTables(dataSource));

  it('stores the emoji, or null when none is given', async () => {
    const ana = await createUser();
    const home = await accounts.create(ana.id, 'Home');

    await categories.create(home.id, ana.id, { name: 'Food', emoji: '🛒' });
    await categories.create(home.id, ana.id, { name: 'Rent' });

    const list = await categories.list(home.id, ana.id);
    expect(list.map((c) => [c.name, c.emoji])).toEqual([
      ['Food', '🛒'],
      ['Rent', null],
    ]);
  });

  it('answers 404 to a non-member and creates nothing', async () => {
    const ana = await createUser('ana@example.com');
    const bob = await createUser('bob@example.com');
    const home = await accounts.create(ana.id, 'Home');

    await expect(categories.list(home.id, bob.id)).rejects.toThrow(
      new NotFoundException('Account not found'),
    );
    await expect(
      categories.create(home.id, bob.id, { name: 'Food' }),
    ).rejects.toThrow(new NotFoundException('Account not found'));
    expect(await categoryCount()).toBe(0);
  });

  it('rejects a name the account already has in any case, but not in another account', async () => {
    const ana = await createUser();
    const home = await accounts.create(ana.id, 'Home');
    const trip = await accounts.create(ana.id, 'Trip');
    await categories.create(home.id, ana.id, { name: 'Food' });

    await expect(
      categories.create(home.id, ana.id, { name: 'FOOD' }),
    ).rejects.toThrow(
      new ConflictException('A category with that name already exists'),
    );
    await expect(
      categories.create(trip.id, ana.id, { name: 'FOOD' }),
    ).resolves.toMatchObject({ name: 'FOOD' });
  });

  it('deletes the categories with their account', async () => {
    const ana = await createUser();
    const home = await accounts.create(ana.id, 'Home');
    await categories.create(home.id, ana.id, { name: 'Food' });

    await accounts.delete(home.id, ana.id);

    expect(await categoryCount()).toBe(0);
  });

  it('answers 409, never a database error, when the same name is added twice at once', async () => {
    for (let round = 0; round < 10; round++) {
      await truncateTables(dataSource);
      const ana = await createUser();
      const home = await accounts.create(ana.id, 'Home');

      const results = await Promise.allSettled([
        categories.create(home.id, ana.id, { name: 'Food' }),
        categories.create(home.id, ana.id, { name: 'food' }),
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
        categories.create(home.id, ana.id, { name: 'Food' }),
      ]);

      expect(deleted.status).toBe('fulfilled');
      if (created.status === 'rejected') {
        expect(created.reason).toEqual(
          new NotFoundException('Account not found'),
        );
      }
      expect(await categoryCount()).toBe(0);
    }
  });
});
