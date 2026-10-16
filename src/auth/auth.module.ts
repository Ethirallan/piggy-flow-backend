import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard.js';
import { jwtOptions } from './jwt-options.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        jwtOptions(config.getOrThrow<string>('JWT_SECRET')),
    }),
  ],
  providers: [
    PasswordService,
    TokenService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [PasswordService, TokenService],
})
export class AuthModule {}
