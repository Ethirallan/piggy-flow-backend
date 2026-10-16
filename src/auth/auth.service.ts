import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { UserResponseDto } from '../users/dto/user-response.dto.js';
import { EmailTakenError } from '../users/email-taken.error.js';
import type { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import type { AuthContext } from './auth-context.js';
import type { AuthResponseDto } from './dto/auth-response.dto.js';
import type { ChangePasswordDto } from './dto/change-password.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { TokenPairDto } from './dto/token-pair.dto.js';
import { PasswordService } from './password.service.js';
import { SessionsService } from './sessions.service.js';
import { TokenService } from './token.service.js';

export const INVALID_CREDENTIALS = 'Invalid email or password';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionsService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const passwordHash = await this.passwords.hash(dto.password);
    let user: User;
    try {
      user = await this.users.create({
        email: dto.email,
        displayName: dto.displayName,
        passwordHash,
      });
    } catch (error) {
      if (error instanceof EmailTakenError) {
        throw new ConflictException('Email already registered');
      }
      throw error;
    }

    const { sessionId, accessToken, refreshToken } = await this.startSession(
      user.id,
    );
    this.logger.log({ event: 'auth.registered', userId: user.id, sessionId });
    return { accessToken, refreshToken, user: UserResponseDto.from(user) };
  }

  async login(dto: LoginDto, ip: string | undefined): Promise<AuthResponseDto> {
    const user = await this.users.findByEmail(dto.email);
    // An unknown email still costs a full argon2 check, so timing doesn't reveal it.
    const passwordOk = user
      ? await this.passwords.verify(user.passwordHash, dto.password)
      : await this.passwords.verifyDummy(dto.password);
    if (!user || !passwordOk) {
      this.logger.warn({ event: 'auth.login_failed', ip });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const { sessionId, accessToken, refreshToken } = await this.startSession(
      user.id,
    );
    this.logger.log({ event: 'auth.logged_in', userId: user.id, sessionId });
    return { accessToken, refreshToken, user: UserResponseDto.from(user) };
  }

  async refresh(refreshToken: string): Promise<TokenPairDto> {
    const result = await this.sessions.rotate(refreshToken);
    if (result.status === 'reused') {
      this.logger.warn({
        event: 'auth.refresh_reuse_detected',
        userId: result.userId,
        sessionId: result.sessionId,
      });
    }
    if (result.status !== 'rotated') {
      throw new UnauthorizedException();
    }
    const accessToken = await this.tokens.signAccessToken({
      sub: result.userId,
      sid: result.sessionId,
    });
    return { accessToken, refreshToken: result.refreshToken };
  }

  /** Always succeeds, so the endpoint can't be used to test tokens. */
  async logout(refreshToken: string): Promise<void> {
    const session = await this.sessions.revoke(refreshToken);
    if (session) {
      this.logger.log({ event: 'auth.logged_out', ...session });
    }
  }

  async logoutAll(auth: AuthContext): Promise<void> {
    await this.sessions.revokeAll(auth.userId);
    this.logger.log({
      event: 'auth.logged_out_everywhere',
      userId: auth.userId,
    });
  }

  /** Signs out every other device; the current one keeps working with a new pair. */
  async changePassword(
    auth: AuthContext,
    dto: ChangePasswordDto,
  ): Promise<TokenPairDto> {
    const user = await this.users.findById(auth.userId);
    if (!user) {
      throw new UnauthorizedException();
    }
    if (
      !(await this.passwords.verify(user.passwordHash, dto.currentPassword))
    ) {
      throw new ForbiddenException('Current password is incorrect');
    }
    // Renew first: if the current session is gone, nothing changes.
    const refreshToken = await this.sessions.reissue(auth.sessionId);
    if (!refreshToken) {
      throw new UnauthorizedException();
    }
    await this.users.updatePasswordHash(
      user.id,
      await this.passwords.hash(dto.newPassword),
    );
    await this.sessions.revokeAllExcept(user.id, auth.sessionId);

    this.logger.log({
      event: 'auth.password_changed',
      userId: user.id,
      sessionId: auth.sessionId,
    });
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      sid: auth.sessionId,
    });
    return { accessToken, refreshToken };
  }

  private async startSession(
    userId: string,
  ): Promise<{ sessionId: string } & TokenPairDto> {
    const { sessionId, refreshToken } = await this.sessions.create(userId);
    const accessToken = await this.tokens.signAccessToken({
      sub: userId,
      sid: sessionId,
    });
    return { sessionId, accessToken, refreshToken };
  }
}
