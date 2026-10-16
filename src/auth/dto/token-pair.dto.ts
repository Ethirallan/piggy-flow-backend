export class TokenPairDto {
  /** Bearer token for API calls, valid for 15 minutes. */
  accessToken: string;

  /** Exchange at POST /auth/refresh for a new pair. Each one works once. */
  refreshToken: string;
}
