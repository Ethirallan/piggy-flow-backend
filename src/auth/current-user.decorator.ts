import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthContext, AuthenticatedRequest } from './auth-context.js';

/** The caller's user and session ids. Only valid on routes that aren't @Public(). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) {
      throw new Error(
        '@CurrentUser() used on a route the AuthGuard did not check',
      );
    }
    return request.auth;
  },
);
