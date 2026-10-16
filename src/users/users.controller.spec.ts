import { UnauthorizedException } from '@nestjs/common';
import { User } from './user.entity.js';
import { UsersController } from './users.controller.js';
import type { UsersService } from './users.service.js';

const auth = { userId: 'user-1', sessionId: 'session-1' };
const user: User = {
  id: 'user-1',
  email: 'ana@example.com',
  displayName: 'Ana',
  passwordHash: 'secret-hash',
  createdAt: new Date('2026-10-16T08:00:00Z'),
  updatedAt: new Date('2026-10-16T08:00:00Z'),
};

describe('UsersController', () => {
  const users = { findById: vi.fn(), updateDisplayName: vi.fn() };
  const controller = new UsersController(users as unknown as UsersService);

  it('returns the caller without the password hash', async () => {
    users.findById.mockResolvedValue(user);

    const result = await controller.me(auth);

    expect(users.findById).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({
      id: 'user-1',
      email: 'ana@example.com',
      displayName: 'Ana',
      createdAt: user.createdAt,
    });
  });

  it('answers 401 when the user behind the token no longer exists', async () => {
    users.findById.mockResolvedValue(null);
    await expect(controller.me(auth)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('updates the display name of the caller', async () => {
    users.updateDisplayName.mockResolvedValue(
      Object.assign(new User(), user, { displayName: 'Ana B' }),
    );

    const result = await controller.updateMe(auth, { displayName: 'Ana B' });

    expect(users.updateDisplayName).toHaveBeenCalledWith('user-1', 'Ana B');
    expect(result.displayName).toBe('Ana B');
  });
});
