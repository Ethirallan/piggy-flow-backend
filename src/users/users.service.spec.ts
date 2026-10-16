import { QueryFailedError, type Repository } from 'typeorm';
import { EmailTakenError } from './email-taken.error.js';
import type { User } from './user.entity.js';
import { UsersService } from './users.service.js';

function createRepository() {
  return {
    findOneBy: vi.fn(),
    create: vi.fn((input: Partial<User>) => ({ ...input }) as User),
    save: vi.fn(async (user: User) => Object.assign(user, { id: 'user-1' })),
    update: vi.fn(),
  };
}

function uniqueViolation() {
  return new QueryFailedError(
    'INSERT INTO "users"',
    [],
    Object.assign(new Error('duplicate key value'), { code: '23505' }),
  );
}

describe('UsersService', () => {
  let repository: ReturnType<typeof createRepository>;
  let service: UsersService;

  beforeEach(() => {
    repository = createRepository();
    service = new UsersService(repository as unknown as Repository<User>);
  });

  it('looks users up by normalized email', async () => {
    await service.findByEmail('  Ana@Example.COM ');
    expect(repository.findOneBy).toHaveBeenCalledWith({
      email: 'ana@example.com',
    });
  });

  it('stores a normalized email and a trimmed display name', async () => {
    const user = await service.create({
      email: ' Ana@Example.com',
      displayName: '  Ana  ',
      passwordHash: 'hash',
    });

    expect(repository.create).toHaveBeenCalledWith({
      email: 'ana@example.com',
      displayName: 'Ana',
      passwordHash: 'hash',
    });
    expect(user.id).toBe('user-1');
  });

  it('turns a unique violation into EmailTakenError', async () => {
    repository.save.mockRejectedValue(uniqueViolation());
    await expect(
      service.create({
        email: 'ana@example.com',
        displayName: 'Ana',
        passwordHash: 'h',
      }),
    ).rejects.toBeInstanceOf(EmailTakenError);
  });

  it('rethrows other database errors', async () => {
    const error = new Error('connection lost');
    repository.save.mockRejectedValue(error);
    await expect(
      service.create({
        email: 'ana@example.com',
        displayName: 'Ana',
        passwordHash: 'h',
      }),
    ).rejects.toBe(error);
  });

  it('trims the new display name and returns the reloaded user', async () => {
    const reloaded = { id: 'user-1', displayName: 'Ana B' } as User;
    repository.findOneBy.mockResolvedValue(reloaded);

    await expect(service.updateDisplayName('user-1', ' Ana B ')).resolves.toBe(
      reloaded,
    );
    expect(repository.update).toHaveBeenCalledWith(
      { id: 'user-1' },
      { displayName: 'Ana B' },
    );
  });

  it('updates the password hash', async () => {
    await service.updatePasswordHash('user-1', 'new-hash');
    expect(repository.update).toHaveBeenCalledWith(
      { id: 'user-1' },
      { passwordHash: 'new-hash' },
    );
  });
});
