import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { createIntegrationModule, truncateTables } from '../../test/db.js';
import { User } from '../users/user.entity.js';
import { UsersModule } from '../users/users.module.js';
import { UsersService } from '../users/users.service.js';
import { AccountMember } from './account-member.entity.js';
import { Account } from './account.entity.js';
import { AccountsModule } from './accounts.module.js';
import { AccountsService } from './accounts.service.js';

describe('AccountsService (integration)', () => {
  let moduleRef: TestingModule;
  let accounts: AccountsService;
  let users: UsersService;
  let dataSource: DataSource;

  const createUser = (email = 'ana@example.com') =>
    users.create({ email, displayName: 'Ana', passwordHash: 'hash' });

  beforeAll(async () => {
    moduleRef = await createIntegrationModule({
      imports: [UsersModule, AccountsModule],
    });
    accounts = moduleRef.get(AccountsService);
    users = moduleRef.get(UsersService);
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(() => moduleRef.close());

  beforeEach(() => truncateTables(dataSource));

  describe('createPersonal', () => {
    it('creates a Personal account with the user as its only member', async () => {
      const user = await createUser();

      const account = await dataSource.transaction((manager) =>
        accounts.createPersonal(user.id, manager),
      );

      expect(account).toMatchObject({ name: 'Personal', isPersonal: true });
      await expect(
        dataSource
          .getRepository(AccountMember)
          .findBy({ accountId: account.id }),
      ).resolves.toEqual([
        expect.objectContaining({
          userId: user.id,
          joinedAt: expect.any(Date),
        }),
      ]);
    });
  });

  describe('cascades', () => {
    it('removes the memberships when the account is deleted', async () => {
      const user = await createUser();
      const account = await dataSource.transaction((manager) =>
        accounts.createPersonal(user.id, manager),
      );

      await dataSource.getRepository(Account).delete({ id: account.id });

      await expect(
        dataSource.getRepository(AccountMember).count(),
      ).resolves.toBe(0);
    });

    it('removes the memberships, not the account, when the user is deleted', async () => {
      const user = await createUser();
      await dataSource.transaction((manager) =>
        accounts.createPersonal(user.id, manager),
      );

      await dataSource.getRepository(User).delete({ id: user.id });

      await expect(
        dataSource.getRepository(AccountMember).count(),
      ).resolves.toBe(0);
      await expect(dataSource.getRepository(Account).count()).resolves.toBe(1);
    });
  });

  describe('findForMember and details', () => {
    it('returns the account and its members in the order they joined', async () => {
      const ana = await createUser('ana@example.com');
      const bob = await createUser('bob@example.com');
      const account = await accounts.create(ana.id, 'Home');
      await dataSource
        .getRepository(AccountMember)
        .insert({ accountId: account.id, userId: bob.id });

      const details = await accounts.details(account.id, bob.id);

      expect(details.account).toMatchObject({ id: account.id, name: 'Home' });
      expect(details.members.map((m) => m.user?.email)).toEqual([
        'ana@example.com',
        'bob@example.com',
      ]);
    });

    it('answers 404 to a user who is not a member, and for an unknown id', async () => {
      const ana = await createUser('ana@example.com');
      const bob = await createUser('bob@example.com');
      const account = await accounts.create(ana.id, 'Home');

      await expect(
        accounts.findForMember(account.id, bob.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        accounts.findForMember(randomUUID(), ana.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
