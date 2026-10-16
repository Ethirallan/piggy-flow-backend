import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './auth-context.js';
import { AuthGuard } from './auth.guard.js';
import type { TokenService } from './token.service.js';

function httpContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  const reflector = { getAllAndOverride: vi.fn() };
  const tokens = { verifyAccessToken: vi.fn() };
  const guard = new AuthGuard(
    reflector as unknown as Reflector,
    tokens as unknown as TokenService,
  );

  beforeEach(() => {
    reflector.getAllAndOverride.mockReturnValue(false);
    tokens.verifyAccessToken.mockReset();
  });

  it('lets public routes through without looking at the token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(httpContext({ headers: {} }))).resolves.toBe(
      true,
    );
    expect(tokens.verifyAccessToken).not.toHaveBeenCalled();
  });

  it.each([
    ['no header', undefined],
    ['another scheme', 'Basic dXNlcjpwYXNz'],
    ['an empty bearer token', 'Bearer '],
  ])('rejects %s', async (_case, authorization) => {
    await expect(
      guard.canActivate(httpContext({ headers: { authorization } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tokens.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a token that does not verify', async () => {
    tokens.verifyAccessToken.mockResolvedValue(null);
    await expect(
      guard.canActivate(
        httpContext({ headers: { authorization: 'Bearer bad' } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('puts the user and session on the request for a valid token', async () => {
    tokens.verifyAccessToken.mockResolvedValue({
      sub: 'user-1',
      sid: 'session-1',
    });
    const request: Partial<AuthenticatedRequest> = {
      headers: { authorization: 'bearer good' },
    };

    await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
    expect(tokens.verifyAccessToken).toHaveBeenCalledWith('good');
    expect(request.auth).toEqual({ userId: 'user-1', sessionId: 'session-1' });
  });
});
