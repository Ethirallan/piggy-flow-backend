import { timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Session } from './session.entity.js';
import { TokenService } from './token.service.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface IssuedSession {
  sessionId: string;
  refreshToken: string;
}

export interface SessionRef {
  userId: string;
  sessionId: string;
}

export type RotateResult =
  | ({ status: 'rotated'; refreshToken: string } & SessionRef)
  | ({ status: 'reused' } & SessionRef)
  | { status: 'invalid' };

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    private readonly tokens: TokenService,
  ) {}

  async create(userId: string): Promise<IssuedSession> {
    const secret = this.tokens.createRefreshSecret();
    const now = new Date();
    const session = await this.sessions.save(
      this.sessions.create({
        userId,
        tokenHash: this.tokens.hashRefreshSecret(secret),
        expiresAt: expiryFrom(now),
        lastUsedAt: now,
      }),
    );
    return {
      sessionId: session.id,
      refreshToken: this.tokens.formatRefreshToken(session.id, secret),
    };
  }

  /**
   * Swaps a refresh token for a new one. A token that was already rotated is
   * treated as stolen: the session is deleted and the device must log in again.
   */
  async rotate(refreshToken: string): Promise<RotateResult> {
    const found = await this.findByToken(refreshToken);
    if (!found || found.session.expiresAt.getTime() <= Date.now()) {
      return { status: 'invalid' };
    }
    const { session, matches } = found;
    const ref = { userId: session.userId, sessionId: session.id };
    if (!matches) {
      await this.sessions.delete({ id: session.id });
      return { status: 'reused', ...ref };
    }

    const secret = this.tokens.createRefreshSecret();
    const now = new Date();
    // Only succeeds if nobody rotated the token since we read it.
    const result = await this.sessions.update(
      { id: session.id, tokenHash: session.tokenHash },
      {
        tokenHash: this.tokens.hashRefreshSecret(secret),
        expiresAt: expiryFrom(now),
        lastUsedAt: now,
      },
    );
    if (result.affected !== 1) {
      return { status: 'invalid' };
    }
    return {
      status: 'rotated',
      ...ref,
      refreshToken: this.tokens.formatRefreshToken(session.id, secret),
    };
  }

  /** Deletes the session the token belongs to, if the token is its current one. */
  async revoke(refreshToken: string): Promise<SessionRef | null> {
    const found = await this.findByToken(refreshToken);
    if (!found?.matches) {
      return null;
    }
    await this.sessions.delete({ id: found.session.id });
    return { userId: found.session.userId, sessionId: found.session.id };
  }

  async revokeAll(userId: string): Promise<void> {
    await this.sessions.delete({ userId });
  }

  async revokeAllExcept(userId: string, keepSessionId: string): Promise<void> {
    await this.sessions.delete({ userId, id: Not(keepSessionId) });
  }

  /** Gives an existing session a new refresh secret, e.g. after a password change. */
  async reissue(sessionId: string): Promise<string | null> {
    const secret = this.tokens.createRefreshSecret();
    const now = new Date();
    const result = await this.sessions.update(
      { id: sessionId },
      {
        tokenHash: this.tokens.hashRefreshSecret(secret),
        expiresAt: expiryFrom(now),
        lastUsedAt: now,
      },
    );
    return result.affected === 1
      ? this.tokens.formatRefreshToken(sessionId, secret)
      : null;
  }

  private async findByToken(
    refreshToken: string,
  ): Promise<{ session: Session; matches: boolean } | null> {
    const parsed = this.tokens.parseRefreshToken(refreshToken);
    if (!parsed) {
      return null;
    }
    const session = await this.sessions.findOneBy({ id: parsed.sessionId });
    if (!session) {
      return null;
    }
    const presented = this.tokens.hashRefreshSecret(parsed.secret);
    return { session, matches: hashesMatch(presented, session.tokenHash) };
  }
}

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
