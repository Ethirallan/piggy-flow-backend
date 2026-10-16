import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { UserResponseDto } from '../users/dto/user-response.dto.js';
import { EmailTakenError } from '../users/email-taken.error.js';
import type { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import type { AuthResponseDto } from './dto/auth-response.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { TokenPairDto } from './dto/token-pair.dto.js';
import { PasswordService } from './password.service.js';
import { SessionsService } from './sessions.service.js';
import { TokenService } from './token.service.js';

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
