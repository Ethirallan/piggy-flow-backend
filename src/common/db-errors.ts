import { QueryFailedError } from 'typeorm';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

function hasPostgresCode(error: unknown, code: string): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: unknown }).code === code
  );
}

/** A unique index or constraint rejected the write. */
export function isUniqueViolation(error: unknown): boolean {
  return hasPostgresCode(error, UNIQUE_VIOLATION);
}

/** A foreign key rejected the write, e.g. the referenced row is gone. */
export function isForeignKeyViolation(error: unknown): boolean {
  return hasPostgresCode(error, FOREIGN_KEY_VIOLATION);
}

/** The constraint a query failure violated, when Postgres names one. */
export function violatedConstraint(error: unknown): string | undefined {
  if (!(error instanceof QueryFailedError)) {
    return undefined;
  }
  const { constraint } = error.driverError as { constraint?: unknown };
  return typeof constraint === 'string' ? constraint : undefined;
}
