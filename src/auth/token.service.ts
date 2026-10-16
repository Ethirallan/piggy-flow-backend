import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
}

export interface ParsedRefreshToken {
  sessionId: string;
  secret: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 32 random bytes in base64url without padding.
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync({ sub: payload.sub, sid: payload.sid });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
    try {
      const claims = await this.jwt.verifyAsync<Record<string, unknown>>(token);
      if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string') {
        return null;
      }
      return { sub: claims.sub, sid: claims.sid };
    } catch {
      return null;
    }
  }

  createRefreshSecret(): string {
    return randomBytes(32).toString('base64url');
  }

  /** A refresh token is `<sessionId>.<secret>`; only the secret's hash is stored. */
  formatRefreshToken(sessionId: string, secret: string): string {
    return `${sessionId}.${secret}`;
  }

  parseRefreshToken(token: string): ParsedRefreshToken | null {
    const parts = token.split('.');
    if (parts.length !== 2) {
      return null;
    }
    const [sessionId, secret] = parts;
    if (!UUID_PATTERN.test(sessionId) || !SECRET_PATTERN.test(secret)) {
      return null;
    }
    return { sessionId, secret };
  }

  hashRefreshSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }
}
