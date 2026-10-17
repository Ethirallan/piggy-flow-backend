import { ConflictException, NotFoundException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { createIntegrationModule, truncateTables } from '../../test/db.js';
import { UsersService } from '../users/users.service.js';
import { AccountMember } from './account-member.entity.js';
import { AccountMembersService } from './account-members.service.js';
import { AccountsModule } from './accounts.module.js';
import { AccountsService } from './accounts.service.js';
import { Account } from './account.entity.js';

describe('AccountMembersService (integration)', () => {
  let moduleRef: TestingModule;
  let accounts: AccountsService;
  let members: AccountMembersService;
  let users: UsersService;
  let dataSource: DataSource;

  const createUser = (email: string) =>
    users.create({ email, displayName: 'Ana', passwordHash: 'hash' });
  const memberCount = (accountId: string) =>
    dataSource.getRepository(AccountMember).countBy({ accountId });

  beforeAll(async () => {
    moduleRef = await createIntegrationModule({ imports: [AccountsModule] });
    accounts = moduleRef.get(AccountsService);
    members = moduleRef.get(AccountMembersService);
    users = moduleRef.get(UsersService);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(() => moduleRef.close());

  beforeEach(() => truncateTables(dataSource));

  it('adds one membership when the same user is added twice at once', async () => {
    // Several rounds, so an unlocked version would almost surely interleave.
    for (let round = 0; round < 10; round++) {
      await truncateTables(dataSource);
      const ana = await createUser('ana@example.com');
      await createUser('bob@example.com');
      const home = await accounts.create(ana.id, 'Home');

      const results = await Promise.allSettled([
        members.add(home.id, ana.id, 'bob@example.com'),
        members.add(home.id, ana.id, 'bob@example.com'),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      // A 409, not a duplicate-key error from the database (a 500).
      const rejected = results.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(rejected?.reason).toBeInstanceOf(ConflictException);
      expect(await memberCount(home.id)).toBe(2);
    }
  });

  it('does not deadlock the connection pool when many members are added at once', async () => {
    // The pg pool default. Each add holds a transaction connection, so if it
    // also needs a second one for the email lookup, this many adds starve the
    // pool and wait forever.
    const POOL_SIZE = 10;
    await createUser('bob@example.com');
    const owners = await Promise.all(
      Array.from({ length: POOL_SIZE }, (_, i) =>
        createUser(`owner${i}@example.com`),
      ),
    );
    const homes = await Promise.all(
      owners.map((owner, i) => accounts.create(owner.id, `Home ${i}`)),
    );

    const results = await Promise.allSettled(
      homes.map((home, i) =>
        members.add(home.id, owners[i].id, 'bob@example.com'),
      ),
    );

    expect(results.map((r) => r.status)).toEqual(
      Array(POOL_SIZE).fill('fulfilled'),
    );
    for (const home of homes) {
      expect(await memberCount(home.id)).toBe(2);
    }
  }, 15_000);

  it('answers 404, never a database error, when the account is deleted while a member is being added', async () => {
    // Several rounds, so an unlocked version would almost surely interleave.
    for (let round = 0; round < 10; round++) {
      await truncateTables(dataSource);
      const ana = await createUser('ana@example.com');
      await createUser('bob@example.com');
      const home = await accounts.create(ana.id, 'Home');

      const results = await Promise.allSettled([
        accounts.delete(home.id, ana.id),
        members.add(home.id, ana.id, 'bob@example.com'),
      ]);

      // Either order is fine: the add lands before the delete (both succeed)
      // or waits for it and finds no account (404).
      expect(results[0].status).toBe('fulfilled');
      if (results[1].status === 'rejected') {
        expect(results[1].reason).toBeInstanceOf(NotFoundException);
      }
      await expect(dataSource.getRepository(Account).count()).resolves.toBe(0);
      await expect(
        dataSource.getRepository(AccountMember).count(),
      ).resolves.toBe(0);
    }
  });

  it('never leaves an account without members when two members remove each other at once', async () => {
    // Several rounds, so an unlocked version would almost surely interleave.
    for (let round = 0; round < 10; round++) {
      await truncateTables(dataSource);
      const ana = await createUser('ana@example.com');
      const bob = await createUser('bob@example.com');
      const home = await accounts.create(ana.id, 'Home');
      await dataSource
        .getRepository(AccountMember)
        .insert({ accountId: home.id, userId: bob.id });

      const results = await Promise.allSettled([
        members.remove(home.id, ana.id, bob.id),
        members.remove(home.id, bob.id, ana.id),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(rejected?.reason).toBeInstanceOf(NotFoundException);
      expect(await memberCount(home.id)).toBe(1);
    }
  });
});
