import { randomUUID } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { createIntegrationModule, truncateTables } from '../../test/db.js';
import { EmailTakenError } from './email-taken.error.js';
import { UsersModule } from './users.module.js';
import { UsersService } from './users.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const input = {
  email: 'ana@example.com',
  displayName: 'Ana',
  passwordHash: 'hash',
};

describe('UsersService (integration)', () => {
  let moduleRef: TestingModule;
  let users: UsersService;

  beforeAll(async () => {
    moduleRef = await createIntegrationModule({ imports: [UsersModule] });
    users = moduleRef.get(UsersService);
  });

  afterAll(() => moduleRef.close());

  beforeEach(() => truncateTables(moduleRef.get(DataSource)));

  it('creates a user with a database-generated id and timestamps', async () => {
    const user = await users.create(input);

    expect(user.id).toMatch(UUID);
    expect(user.createdAt).toBeInstanceOf(Date);
    await expect(users.findById(user.id)).resolves.toMatchObject({
      email: 'ana@example.com',
      displayName: 'Ana',
      passwordHash: 'hash',
    });
  });

  it('rejects a second user with the same email in any case', async () => {
    await users.create(input);

    await expect(
      users.create({ ...input, email: ' ANA@Example.com ' }),
    ).rejects.toBeInstanceOf(EmailTakenError);
  });

  it('finds a user by email regardless of case and spaces', async () => {
    const user = await users.create(input);

    await expect(users.findByEmail('  Ana@EXAMPLE.com')).resolves.toMatchObject(
      {
        id: user.id,
      },
    );
  });

  it('returns null for an unknown id or email', async () => {
    await expect(users.findById(randomUUID())).resolves.toBeNull();
    await expect(users.findByEmail('nobody@example.com')).resolves.toBeNull();
  });

  it('updates the display name and keeps updated_at current', async () => {
    const user = await users.create(input);

    const updated = await users.updateDisplayName(user.id, ' Ana B ');

    expect(updated?.displayName).toBe('Ana B');
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(
      user.updatedAt.getTime(),
    );
  });

  it('updates the password hash', async () => {
    const user = await users.create(input);

    await users.updatePasswordHash(user.id, 'new-hash');

    await expect(users.findById(user.id)).resolves.toMatchObject({
      passwordHash: 'new-hash',
    });
  });
});
