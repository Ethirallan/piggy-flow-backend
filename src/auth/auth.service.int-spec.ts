import { JwtModule } from '@nestjs/jwt';
import type { TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createIntegrationModule, truncateTables } from '../../test/db.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { UsersModule } from '../users/users.module.js';
import { AuthService } from './auth.service.js';
import { jwtOptions } from './jwt-options.js';
import { PasswordService } from './password.service.js';
import { Session } from './session.entity.js';
import { SessionsService } from './sessions.service.js';
import { TokenService } from './token.service.js';

const email = 'ana@example.com';
const password = 'correct horse battery staple';

describe('AuthService (integration)', () => {
  let moduleRef: TestingModule;
  let auth: AuthService;
  let sessions: SessionsService;
  let tokens: TokenService;

  const count = async (table: string): Promise<number> => {
    const [row] = await moduleRef
      .get(DataSource)
      .query(`SELECT count(*)::int AS count FROM "${table}"`);
    return row.count;
  };

  beforeAll(async () => {
    moduleRef = await createIntegrationModule({
      imports: [
        UsersModule,
        AccountsModule,
        TypeOrmModule.forFeature([Session]),
        JwtModule.register(jwtOptions('s'.repeat(32))),
      ],
      providers: [PasswordService, TokenService, SessionsService, AuthService],
    });
    auth = moduleRef.get(AuthService);
    sessions = moduleRef.get(SessionsService);
    tokens = moduleRef.get(TokenService);
  });

  afterAll(() => moduleRef.close());

  beforeEach(() => truncateTables(moduleRef.get(DataSource)));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves no user behind when the session cannot be created during register', async () => {
    vi.spyOn(sessions, 'create').mockRejectedValueOnce(
      new Error('session insert failed'),
    );

    await expect(
      auth.register({ email, password, displayName: 'Ana' }),
    ).rejects.toThrow('session insert failed');

    expect(await count('users')).toBe(0);
    expect(await count('accounts')).toBe(0);
    // The same email can register once the failure is gone.
    await expect(
      auth.register({ email, password, displayName: 'Ana' }),
    ).resolves.toMatchObject({ user: { email } });
  });

  it('leaves no user behind when the Personal account cannot be created during register', async () => {
    vi.spyOn(
      moduleRef.get(AccountsService),
      'createPersonal',
    ).mockRejectedValueOnce(new Error('account insert failed'));

    await expect(
      auth.register({ email, password, displayName: 'Ana' }),
    ).rejects.toThrow('account insert failed');

    expect(await count('users')).toBe(0);
    expect(await count('sessions')).toBe(0);
    await expect(
      auth.register({ email, password, displayName: 'Ana' }),
    ).resolves.toMatchObject({ user: { email } });
  });

  it('changes nothing when signing out the other devices fails during a password change', async () => {
    const phone = await auth.register({ email, password, displayName: 'Ana' });
    const laptop = await auth.login({ email, password }, undefined);
    const phoneSessionId = tokens.parseRefreshToken(
      phone.refreshToken,
    )!.sessionId;
    vi.spyOn(sessions, 'revokeAllExcept').mockRejectedValueOnce(
      new Error('delete failed'),
    );

    await expect(
      auth.changePassword(
        { userId: phone.user.id, sessionId: phoneSessionId },
        { currentPassword: password, newPassword: 'a brand new passphrase' },
      ),
    ).rejects.toThrow('delete failed');

    await expect(
      auth.login({ email, password }, undefined),
    ).resolves.toBeDefined();
    await expect(auth.refresh(laptop.refreshToken)).resolves.toBeDefined();
    await expect(auth.refresh(phone.refreshToken)).resolves.toBeDefined();
  });
});
