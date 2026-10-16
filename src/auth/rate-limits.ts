const MINUTE_MS = 60_000;

/** Per-IP limits on the auth routes that check a password or a token. */
export const AUTH_RATE_LIMITS = {
  login: { default: { limit: 5, ttl: MINUTE_MS } },
  register: { default: { limit: 5, ttl: MINUTE_MS } },
  // Each attempt costs a full argon2 check, and a correct guess takes over the account.
  changePassword: { default: { limit: 5, ttl: MINUTE_MS } },
  // Apps refresh often, and several devices can share one IP.
  refresh: { default: { limit: 30, ttl: MINUTE_MS } },
};
