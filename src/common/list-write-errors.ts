import { ConflictException, NotFoundException } from '@nestjs/common';
import { ACCOUNT_NOT_FOUND } from '../accounts/accounts.service.js';
import { isForeignKeyViolation, isUniqueViolation } from './db-errors.js';

/**
 * For writes to rows an account owns (shops, categories): the unique
 * (account, name) index means a duplicate name (409); a foreign-key failure
 * means the account was deleted after the membership check (404).
 */
export function rethrowListWriteError(
  error: unknown,
  nameTaken: string,
): never {
  if (isUniqueViolation(error)) {
    throw new ConflictException(nameTaken);
  }
  if (isForeignKeyViolation(error)) {
    throw new NotFoundException(ACCOUNT_NOT_FOUND);
  }
  throw error;
}
