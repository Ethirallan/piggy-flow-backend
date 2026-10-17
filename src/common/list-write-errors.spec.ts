import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { rethrowListWriteError } from './list-write-errors.js';

const queryError = (code: string) =>
  new QueryFailedError(
    'INSERT …',
    [],
    Object.assign(new Error(code), { code }),
  );

describe('rethrowListWriteError', () => {
  it('turns a duplicate name into 409 with the given message', () => {
    expect(() => rethrowListWriteError(queryError('23505'), 'Taken')).toThrow(
      new ConflictException('Taken'),
    );
  });

  it('turns a missing account into 404 Account not found', () => {
    expect(() => rethrowListWriteError(queryError('23503'), 'Taken')).toThrow(
      new NotFoundException('Account not found'),
    );
  });

  it('rethrows anything else unchanged', () => {
    const error = new Error('boom');
    expect(() => rethrowListWriteError(error, 'Taken')).toThrow(error);
  });
});
