const REQUIRED_KEYS = [
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_DATABASE',
  'JWT_SECRET',
] as const;

const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Checks the environment once at startup. Throwing here stops the app before
 * it listens, with every problem listed at once.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const errors: string[] = [];

  for (const key of REQUIRED_KEYS) {
    const value = config[key];
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`${key} is required`);
    }
  }

  const port = config.DB_PORT;
  if (typeof port === 'string' && port.trim() !== '' && !/^\d+$/.test(port)) {
    errors.push('DB_PORT must be a number');
  }

  const secret = config.JWT_SECRET;
  if (
    typeof secret === 'string' &&
    secret.trim() !== '' &&
    secret.length < MIN_JWT_SECRET_LENGTH
  ) {
    errors.push(
      `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`,
    );
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment:\n- ${errors.join('\n- ')}`);
  }
  return config;
}
