import { QueryFailedError } from 'typeorm';
import {
  isForeignKeyViolation,
  isUniqueViolation,
  violatedConstraint,
} from './db-errors.js';

const queryError = (code: string) =>
  new QueryFailedError(
    'INSERT …',
    [],
    Object.assign(new Error(code), { code }),
  );

describe('db-errors', () => {
  it('recognizes a unique violation', () => {
    expect(isUniqueViolation(queryError('23505'))).toBe(true);
    expect(isUniqueViolation(queryError('23503'))).toBe(false);
  });

  it('recognizes a foreign-key violation', () => {
    expect(isForeignKeyViolation(queryError('23503'))).toBe(true);
    expect(isForeignKeyViolation(queryError('23505'))).toBe(false);
  });

  it('ignores errors that are not query failures', () => {
    const plain = Object.assign(new Error('x'), { code: '23505' });
    expect(isUniqueViolation(plain)).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
  });

  it('reports the violated constraint of a query failure', () => {
    const error = new QueryFailedError(
      'INSERT …',
      [],
      Object.assign(new Error('fk'), { code: '23503', constraint: 'FK_x' }),
    );
    expect(violatedConstraint(error)).toBe('FK_x');
    expect(violatedConstraint(new Error('x'))).toBeUndefined();
  });
});
