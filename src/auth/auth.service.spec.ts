import {
  ConflictException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { MockInstance } from 'vitest';
import { EmailTakenError } from '../users/email-taken.error.js';
import type { User } from '../users/user.entity.js';
import type { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import type { PasswordService } from './password.service.js';
import type { SessionsService } from './sessions.service.js';
import type { TokenService } from './token.service.js';

const user: User = {
  id: 'user-1',
  email: 'ana@example.com',
  displayName: 'Ana',
  passwordHash: 'stored-hash',
  createdAt: new Date('2026-10-16T08:00:00Z'),
  updatedAt: new Date('2026-10-16T08:00:00Z'),
};

function setup() {
  const users = {
    create: vi.fn().mockResolvedValue(user),
    findByEmail: vi.fn(),
    findById: vi.fn(),
    updatePasswordHash: vi.fn(),
  };
  const passwords = {
    hash: vi.fn().mockResolvedValue('new-hash'),
    verify: vi.fn(),
    verifyDummy: vi.fn().mockResolvedValue(false),
  };
  const tokens = { signAccessToken: vi.fn().mockResolvedValue('access-token') };
  const sessions = {
    create: vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      refreshToken: 'refresh-token',
    }),
    rotate: vi.fn(),
    revoke: vi.fn(),
    revokeAll: vi.fn(),
    revokeAllExcept: vi.fn(),
    reissue: vi.fn(),
  };
  const service = new AuthService(
    users as unknown as UsersService,
    passwords as unknown as PasswordService,
    tokens as unknown as TokenService,
    sessions as unknown as SessionsService,
  );
  return { service, users, passwords, tokens, sessions };
}

describe('AuthService', () => {
  let log: MockInstance;
  let warn: MockInstance;

  beforeEach(() => {
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('register', () => {
    const dto = {
      email: 'ana@example.com',
      password: 'correct horse',
      displayName: 'Ana',
    };

    it('stores the hashed password and starts a session', async () => {
      const { service, users, passwords, tokens, sessions } = setup();

      await expect(service.register(dto)).resolves.toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: 'user-1',
          email: 'ana@example.com',
          displayName: 'Ana',
          createdAt: user.createdAt,
        },
      });
      expect(passwords.hash).toHaveBeenCalledWith('correct horse');
      expect(users.create).toHaveBeenCalledWith({
        email: 'ana@example.com',
        displayName: 'Ana',
        passwordHash: 'new-hash',
      });
      expect(sessions.create).toHaveBeenCalledWith('user-1');
      expect(tokens.signAccessToken).toHaveBeenCalledWith({
        sub: 'user-1',
        sid: 'session-1',
      });
    });

    it('answers 409 when the email is taken', async () => {
      const { service, users, sessions } = setup();
      users.create.mockRejectedValue(new EmailTakenError());

      await expect(service.register(dto)).rejects.toThrow(
        new ConflictException('Email already registered'),
      );
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('logs the registration without the email or password', async () => {
      const { service } = setup();

      await service.register(dto);

      const calls = JSON.stringify(log.mock.calls);
      expect(calls).toContain('auth.registered');
      expect(calls).not.toContain('ana@example.com');
      expect(calls).not.toContain('correct horse');
    });
  });

  describe('login', () => {
    const dto = { email: 'ana@example.com', password: 'hunter22-secret' };

    it('starts a session for the right password', async () => {
      const { service, users, passwords, sessions } = setup();
      users.findByEmail.mockResolvedValue(user);
      passwords.verify.mockResolvedValue(true);

      await expect(service.login(dto, '1.2.3.4')).resolves.toMatchObject({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: 'user-1' },
      });
      expect(passwords.verify).toHaveBeenCalledWith(
        'stored-hash',
        'hunter22-secret',
      );
      expect(sessions.create).toHaveBeenCalledWith('user-1');
    });

    it('gives the same error for a wrong password and an unknown email', async () => {
      const wrongPassword = setup();
      wrongPassword.users.findByEmail.mockResolvedValue(user);
      wrongPassword.passwords.verify.mockResolvedValue(false);
      const unknownEmail = setup();
      unknownEmail.users.findByEmail.mockResolvedValue(null);

      const expected = new UnauthorizedException('Invalid email or password');
      await expect(wrongPassword.service.login(dto, undefined)).rejects.toThrow(
        expected,
      );
      await expect(unknownEmail.service.login(dto, undefined)).rejects.toThrow(
        expected,
      );
      expect(wrongPassword.sessions.create).not.toHaveBeenCalled();
      expect(unknownEmail.sessions.create).not.toHaveBeenCalled();
    });

    it('still runs a password check for an unknown email', async () => {
      const { service, users, passwords } = setup();
      users.findByEmail.mockResolvedValue(null);

      await expect(service.login(dto, undefined)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(passwords.verifyDummy).toHaveBeenCalledWith('hunter22-secret');
    });

    it('logs failures and successes without the email or password', async () => {
      const { service, users, passwords } = setup();
      users.findByEmail.mockResolvedValueOnce(null).mockResolvedValueOnce(user);
      passwords.verify.mockResolvedValue(true);

      await expect(service.login(dto, '1.2.3.4')).rejects.toThrow();
      await service.login(dto, '1.2.3.4');

      const calls = JSON.stringify([...log.mock.calls, ...warn.mock.calls]);
      expect(calls).toContain('auth.login_failed');
      expect(calls).toContain('auth.logged_in');
      expect(calls).toContain('1.2.3.4');
      expect(calls).not.toContain('ana@example.com');
      expect(calls).not.toContain('hunter22-secret');
    });
  });

  describe('refresh', () => {
    it('returns a new pair for a rotated session', async () => {
      const { service, sessions, tokens } = setup();
      sessions.rotate.mockResolvedValue({
        status: 'rotated',
        userId: 'user-1',
        sessionId: 'session-1',
        refreshToken: 'next-refresh',
      });

      await expect(service.refresh('old-refresh')).resolves.toEqual({
        accessToken: 'access-token',
        refreshToken: 'next-refresh',
      });
      expect(tokens.signAccessToken).toHaveBeenCalledWith({
        sub: 'user-1',
        sid: 'session-1',
      });
    });

    it('answers 401 for an invalid token', async () => {
      const { service, sessions } = setup();
      sessions.rotate.mockResolvedValue({ status: 'invalid' });

      await expect(service.refresh('bad')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('answers 401 and warns when a used token comes back', async () => {
      const { service, sessions } = setup();
      sessions.rotate.mockResolvedValue({
        status: 'reused',
        userId: 'user-1',
        sessionId: 'session-1',
      });

      await expect(service.refresh('old')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(warn).toHaveBeenCalledWith({
        event: 'auth.refresh_reuse_detected',
        userId: 'user-1',
        sessionId: 'session-1',
      });
    });
  });

  describe('logout', () => {
    it('revokes the session and logs it', async () => {
      const { service, sessions } = setup();
      sessions.revoke.mockResolvedValue({
        userId: 'user-1',
        sessionId: 'session-1',
      });

      await service.logout('refresh');

      expect(sessions.revoke).toHaveBeenCalledWith('refresh');
      expect(log).toHaveBeenCalledWith({
        event: 'auth.logged_out',
        userId: 'user-1',
        sessionId: 'session-1',
      });
    });

    it('does nothing for a token that matches no session', async () => {
      const { service, sessions } = setup();
      sessions.revoke.mockResolvedValue(null);

      await expect(service.logout('bad')).resolves.toBeUndefined();
      expect(log).not.toHaveBeenCalled();
    });

    it('revokes every session of the caller', async () => {
      const { service, sessions } = setup();

      await service.logoutAll({ userId: 'user-1', sessionId: 'session-1' });

      expect(sessions.revokeAll).toHaveBeenCalledWith('user-1');
    });
  });
});
