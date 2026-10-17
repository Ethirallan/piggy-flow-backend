import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
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
    AccountsModule,
    TypeOrmModule.forFeature([Session]),
    RateLimitModule,
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
