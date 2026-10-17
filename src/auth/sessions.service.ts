import { timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Not, Repository } from 'typeorm';
import { Session } from './session.entity.js';
import { TokenService } from './token.service.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long the token a rotation replaced still gets a harmless 401 instead of
 * ending the session. Covers a device whose requests raced or retried a refresh.
 */
export const REFRESH_GRACE_MS = 30_000;

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
  | ({ status: 'superseded' } & SessionRef)
  | ({ status: 'reused' } & SessionRef)
  | { status: 'invalid' };

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    private readonly tokens: TokenService,
  ) {}

  /** Pass `manager` to run inside that transaction. */
  async create(
    userId: string,
    manager?: EntityManager,
  ): Promise<IssuedSession> {
    const sessions = this.repository(manager);
    const secret = this.tokens.createRefreshSecret();
    const now = new Date();
    const session = await sessions.save(
      sessions.create({
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
   * Swaps a refresh token for a new one. The token the last rotation replaced
   * gets `superseded` for REFRESH_GRACE_MS (a racing or retried request from
   * the same device). Any other old token is treated as stolen: the session
   * is deleted and the device must log in again.
   */
  async rotate(refreshToken: string): Promise<RotateResult> {
    const found = await this.findByToken(refreshToken);
    if (!found || found.session.expiresAt.getTime() <= Date.now()) {
      return { status: 'invalid' };
    }
    const { session, match } = found;
    const ref = { userId: session.userId, sessionId: session.id };
    if (match === 'previous' && withinGrace(session.rotatedAt)) {
      return { status: 'superseded', ...ref };
    }
    if (match !== 'current') {
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
        previousTokenHash: session.tokenHash,
        rotatedAt: now,
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
    if (found?.match !== 'current') {
      return null;
    }
    await this.sessions.delete({ id: found.session.id });
    return { userId: found.session.userId, sessionId: found.session.id };
  }

  async revokeAll(userId: string): Promise<void> {
    await this.sessions.delete({ userId });
  }

  async revokeAllExcept(
    userId: string,
    keepSessionId: string,
    manager?: EntityManager,
  ): Promise<void> {
    await this.repository(manager).delete({ userId, id: Not(keepSessionId) });
  }

  /**
   * Gives an existing session a new refresh secret, e.g. after a password
   * change. Unlike a rotation, the replaced token gets no grace window.
   */
  async reissue(
    sessionId: string,
    manager?: EntityManager,
  ): Promise<string | null> {
    const secret = this.tokens.createRefreshSecret();
    const now = new Date();
    const result = await this.repository(manager).update(
      { id: sessionId },
      {
        tokenHash: this.tokens.hashRefreshSecret(secret),
        previousTokenHash: null,
        rotatedAt: null,
        expiresAt: expiryFrom(now),
        lastUsedAt: now,
      },
    );
    return result.affected === 1
      ? this.tokens.formatRefreshToken(sessionId, secret)
      : null;
  }

  private repository(manager?: EntityManager): Repository<Session> {
    return manager ? manager.getRepository(Session) : this.sessions;
  }

  private async findByToken(
    refreshToken: string,
  ): Promise<{ session: Session; match: TokenMatch } | null> {
    const parsed = this.tokens.parseRefreshToken(refreshToken);
    if (!parsed) {
      return null;
    }
    const session = await this.sessions.findOneBy({ id: parsed.sessionId });
    if (!session) {
      return null;
    }
    const presented = this.tokens.hashRefreshSecret(parsed.secret);
    if (hashesMatch(presented, session.tokenHash)) {
      return { session, match: 'current' };
    }
    if (
      session.previousTokenHash &&
      hashesMatch(presented, session.previousTokenHash)
    ) {
      return { session, match: 'previous' };
    }
    return { session, match: 'none' };
  }
}

type TokenMatch = 'current' | 'previous' | 'none';

function withinGrace(rotatedAt: Date | null): boolean {
  return (
    rotatedAt !== null && Date.now() - rotatedAt.getTime() < REFRESH_GRACE_MS
  );
}

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
