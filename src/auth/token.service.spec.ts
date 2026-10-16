import { JwtService } from '@nestjs/jwt';
import { ACCESS_TOKEN_TTL_SECONDS, jwtOptions } from './jwt-options.js';
import { TokenService } from './token.service.js';

const SECRET = 'test-secret-that-is-at-least-32-characters';
const SESSION_ID = '0b9e6f0e-5f7a-4c1e-9a43-2f4d3c1b2a10';
const payload = { sub: 'user-1', sid: SESSION_ID };

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('TokenService', () => {
  const service = new TokenService(new JwtService(jwtOptions(SECRET)));

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('access tokens', () => {
    it('verifies a token it signed', async () => {
      const token = await service.signAccessToken(payload);
      await expect(service.verifyAccessToken(token)).resolves.toEqual(payload);
    });

    it('rejects an expired token', async () => {
      vi.useFakeTimers();
      const token = await service.signAccessToken(payload);
      vi.advanceTimersByTime((ACCESS_TOKEN_TTL_SECONDS + 1) * 1000);
      await expect(service.verifyAccessToken(token)).resolves.toBeNull();
    });

    it('rejects a token whose payload was changed', async () => {
      const [header, , signature] = (
        await service.signAccessToken(payload)
      ).split('.');
      const forged = `${header}.${base64url({ ...payload, sub: 'someone-else' })}.${signature}`;
      await expect(service.verifyAccessToken(forged)).resolves.toBeNull();
    });

    it('rejects a token signed with another algorithm', async () => {
      const token = await new JwtService({ secret: SECRET }).signAsync(
        payload,
        {
          algorithm: 'HS512',
        },
      );
      await expect(service.verifyAccessToken(token)).resolves.toBeNull();
    });

    it('rejects an unsigned token', async () => {
      const token = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payload)}.`;
      await expect(service.verifyAccessToken(token)).resolves.toBeNull();
    });

    it('rejects a token signed with another secret', async () => {
      const other = new TokenService(
        new JwtService(jwtOptions('x'.repeat(32))),
      );
      const token = await other.signAccessToken(payload);
      await expect(service.verifyAccessToken(token)).resolves.toBeNull();
    });

    it('rejects a token without a session id', async () => {
      const token = await new JwtService(jwtOptions(SECRET)).signAsync({
        sub: 'user-1',
      });
      await expect(service.verifyAccessToken(token)).resolves.toBeNull();
    });
  });

  describe('refresh tokens', () => {
    it('creates 32-byte base64url secrets that differ every time', () => {
      const a = service.createRefreshSecret();
      expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(service.createRefreshSecret()).not.toBe(a);
    });

    it('parses a token it formatted', () => {
      const secret = service.createRefreshSecret();
      const token = service.formatRefreshToken(SESSION_ID, secret);
      expect(service.parseRefreshToken(token)).toEqual({
        sessionId: SESSION_ID,
        secret,
      });
    });

    it.each([
      ['empty', ''],
      ['no secret', SESSION_ID],
      ['not a uuid', `abc.${'a'.repeat(43)}`],
      ['short secret', `${SESSION_ID}.abc`],
      ['extra part', `${SESSION_ID}.${'a'.repeat(43)}.x`],
    ])('rejects a malformed token (%s)', (_case, token) => {
      expect(service.parseRefreshToken(token)).toBeNull();
    });

    it('hashes secrets to stable SHA-256 hex', () => {
      const hash = service.hashRefreshSecret('secret');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(service.hashRefreshSecret('secret')).toBe(hash);
      expect(hash).not.toContain('secret');
    });
  });
});
