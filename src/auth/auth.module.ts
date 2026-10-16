import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthGuard } from './auth.guard.js';
import { jwtOptions } from './jwt-options.js';
import { PasswordService } from './password.service.js';
import { Session } from './session.entity.js';
import { SessionsService } from './sessions.service.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Session]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        jwtOptions(config.getOrThrow<string>('JWT_SECRET')),
    }),
  ],
  providers: [
    PasswordService,
    TokenService,
    SessionsService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [PasswordService, TokenService],
})
export class AuthModule {}
