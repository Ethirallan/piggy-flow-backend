const MINUTE_MS = 60_000;

/** Per-IP limits on the public auth routes. */
export const AUTH_RATE_LIMITS = {
  login: { default: { limit: 5, ttl: MINUTE_MS } },
  register: { default: { limit: 5, ttl: MINUTE_MS } },
  // Apps refresh often, and several devices can share one IP.
  refresh: { default: { limit: 30, ttl: MINUTE_MS } },
};
