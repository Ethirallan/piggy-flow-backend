import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { jwtOptions } from './jwt-options.js';
import { PasswordService } from './password.service.js';
import { Session } from './session.entity.js';
import { SessionsService } from './sessions.service.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([Session]),
    ThrottlerModule.forRoot({
      // Applied per route with @UseGuards(LoggingThrottlerGuard) and @Throttle(...).
      throttlers: [{ limit: 10, ttl: 60_000 }],
      skipIf: () => process.env.RATE_LIMIT_DISABLED === 'true',
    }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        jwtOptions(config.getOrThrow<string>('JWT_SECRET')),
    }),
  ],
  controllers: [AuthController],
  providers: [
    PasswordService,
    TokenService,
    SessionsService,
    AuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [PasswordService, TokenService],
})
export class AuthModule {}
