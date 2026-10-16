import { validateEnv } from './env.validation.js';

const valid = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USERNAME: 'piggy',
  DB_PASSWORD: 'secret',
  DB_DATABASE: 'piggy',
  JWT_SECRET: 'a'.repeat(32),
};

describe('validateEnv', () => {
  it('returns a valid config unchanged', () => {
    expect(validateEnv(valid)).toBe(valid);
  });

  it('lists every missing or blank variable at once', () => {
    expect(() =>
      validateEnv({ ...valid, DB_HOST: ' ', JWT_SECRET: undefined }),
    ).toThrow(/DB_HOST is required[\s\S]*JWT_SECRET is required/);
  });

  it('rejects a DB_PORT that is not a number', () => {
    expect(() => validateEnv({ ...valid, DB_PORT: 'abc' })).toThrow(
      'DB_PORT must be a number',
    );
  });

  it('rejects a JWT_SECRET shorter than 32 characters', () => {
    expect(() => validateEnv({ ...valid, JWT_SECRET: 'a'.repeat(31) })).toThrow(
      'JWT_SECRET must be at least 32 characters',
    );
  });
});
