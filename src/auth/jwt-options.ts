import type { JwtModuleOptions } from '@nestjs/jwt';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** HS256 for signing, and only HS256 accepted when verifying. */
export function jwtOptions(secret: string): JwtModuleOptions {
  return {
    secret,
    signOptions: { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    verifyOptions: { algorithms: ['HS256'] },
  };
}
