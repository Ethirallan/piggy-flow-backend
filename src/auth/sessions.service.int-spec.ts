import { randomUUID } from 'node:crypto';
import { JwtModule } from '@nestjs/jwt';
import type { TestingModule } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';
import { createIntegrationModule, truncateTables } from '../../test/db.js';
import { UsersModule } from '../users/users.module.js';
import { UsersService } from '../users/users.service.js';
import { jwtOptions } from './jwt-options.js';
import { Session } from './session.entity.js';
import { SESSION_TTL_MS, SessionsService } from './sessions.service.js';
import { TokenService } from './token.service.js';

describe('SessionsService (integration)', () => {
  let moduleRef: TestingModule;
  let service: SessionsService;
  let sessions: Repository<Session>;
  let tokens: TokenService;
  let userId: string;

  const createUser = (email: string) =>
    moduleRef
      .get(UsersService)
      .create({ email, displayName: 'Test', passwordHash: 'hash' });

  beforeAll(async () => {
    moduleRef = await createIntegrationModule({
      imports: [
        UsersModule,
        TypeOrmModule.forFeature([Session]),
        JwtModule.register(jwtOptions('s'.repeat(32))),
      ],
      providers: [TokenService, SessionsService],
    });
    service = moduleRef.get(SessionsService);
    sessions = moduleRef.get(getRepositoryToken(Session));
    tokens = moduleRef.get(TokenService);
  });

  afterAll(() => moduleRef.close());

  beforeEach(async () => {
    await truncateTables(moduleRef.get(DataSource));
    userId = (await createUser('ana@example.com')).id;
  });

  it('stores only the hash of the refresh secret, with a 30-day expiry', async () => {
    const { sessionId, refreshToken } = await service.create(userId);

    const row = await sessions.findOneByOrFail({ id: sessionId });
    const { secret } = tokens.parseRefreshToken(refreshToken)!;
    expect(row.userId).toBe(userId);
    expect(row.tokenHash).toBe(tokens.hashRefreshSecret(secret));
    expect(row.tokenHash).not.toContain(secret);
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(
      SESSION_TTL_MS - 60_000,
    );
  });

  it('rotates a valid token, then treats the old one as reuse and ends the session', async () => {
    const { sessionId, refreshToken } = await service.create(userId);

    const rotated = await service.rotate(refreshToken);
    expect(rotated).toMatchObject({ status: 'rotated', userId, sessionId });
    if (rotated.status !== 'rotated') throw new Error('expected rotated');
    expect(rotated.refreshToken).not.toBe(refreshToken);

    await expect(service.rotate(refreshToken)).resolves.toEqual({
      status: 'reused',
      userId,
      sessionId,
    });
    await expect(sessions.existsBy({ id: sessionId })).resolves.toBe(false);
  });

  it('lets exactly one of two simultaneous rotations win', async () => {
    const { refreshToken } = await service.create(userId);

    const results = await Promise.all([
      service.rotate(refreshToken),
      service.rotate(refreshToken),
    ]);

    expect(
      results.filter((result) => result.status === 'rotated'),
    ).toHaveLength(1);
  });

  it('loses the race when another request rotates the token after it was read', async () => {
    const { refreshToken } = await service.create(userId);
    const findOneBy = sessions.findOneBy.bind(sessions);
    // This request reads the session, then another request rotates the same
    // token before this one writes. Only the conditional UPDATE can catch that.
    vi.spyOn(sessions, 'findOneBy').mockImplementationOnce(async (where) => {
      const stale = await findOneBy(where);
      await service.rotate(refreshToken);
      return stale;
    });

    await expect(service.rotate(refreshToken)).resolves.toEqual({
      status: 'invalid',
    });
  });

  it('rejects an expired session', async () => {
    const { sessionId, refreshToken } = await service.create(userId);
    await sessions.update(
      { id: sessionId },
      { expiresAt: new Date(Date.now() - 1_000) },
    );

    await expect(service.rotate(refreshToken)).resolves.toEqual({
      status: 'invalid',
    });
  });

  it('rejects malformed and unknown tokens', async () => {
    await expect(service.rotate('garbage')).resolves.toEqual({
      status: 'invalid',
    });
    const unknown = tokens.formatRefreshToken(
      randomUUID(),
      tokens.createRefreshSecret(),
    );
    await expect(service.rotate(unknown)).resolves.toEqual({
      status: 'invalid',
    });
  });

  it('revokes the session a token belongs to and ignores tokens that do not match', async () => {
    const { sessionId, refreshToken } = await service.create(userId);
    const wrong = tokens.formatRefreshToken(
      sessionId,
      tokens.createRefreshSecret(),
    );

    await expect(service.revoke(wrong)).resolves.toBeNull();
    await expect(service.revoke('garbage')).resolves.toBeNull();
    await expect(sessions.existsBy({ id: sessionId })).resolves.toBe(true);

    await expect(service.revoke(refreshToken)).resolves.toEqual({
      userId,
      sessionId,
    });
    await expect(sessions.existsBy({ id: sessionId })).resolves.toBe(false);
  });

  it('revokes every session of one user and no one else', async () => {
    await service.create(userId);
    await service.create(userId);
    const bob = await service.create((await createUser('bob@example.com')).id);

    await service.revokeAll(userId);

    expect((await sessions.find()).map((row) => row.id)).toEqual([
      bob.sessionId,
    ]);
  });

  it('deletes the sessions of a deleted user', async () => {
    const { sessionId } = await service.create(userId);

    await moduleRef
      .get(DataSource)
      .query(`DELETE FROM users WHERE id = $1`, [userId]);

    await expect(sessions.existsBy({ id: sessionId })).resolves.toBe(false);
  });

  it('revokes every other session of the user and keeps other users', async () => {
    const keep = await service.create(userId);
    await service.create(userId);
    const bob = await service.create((await createUser('bob@example.com')).id);

    await service.revokeAllExcept(userId, keep.sessionId);

    const ids = (await sessions.find()).map((row) => row.id).sort();
    expect(ids).toEqual([keep.sessionId, bob.sessionId].sort());
  });

  it('reissues a fresh refresh token for an existing session', async () => {
    const { sessionId, refreshToken } = await service.create(userId);

    const reissued = await service.reissue(sessionId);

    expect(reissued).not.toBe(refreshToken);
    expect(tokens.parseRefreshToken(reissued!)?.sessionId).toBe(sessionId);
    await expect(service.rotate(refreshToken)).resolves.toMatchObject({
      status: 'reused',
    });
  });

  it('reissues nothing for a session that is gone', async () => {
    await expect(service.reissue(randomUUID())).resolves.toBeNull();
  });
});
