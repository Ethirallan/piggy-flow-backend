import { assertSomethingToUpdate, deleteOrInUse, hasNameClash, parseAccountQuery } from './account-scoped';

describe('account-scoped helpers', () => {
  it('parseAccountQuery accepts digits and undefined, rejects the rest with 400', () => {
    expect(parseAccountQuery(undefined)).toBeUndefined();
    expect(parseAccountQuery('12')).toBe(12);
    for (const bad of ['abc', '', '1.5', '-1']) {
      expect(() => parseAccountQuery(bad)).toThrow('Invalid account.');
    }
  });

  it('assertSomethingToUpdate needs one non-blank string', () => {
    expect(() => assertSomethingToUpdate('a', undefined)).not.toThrow();
    expect(() => assertSomethingToUpdate(undefined, 'b')).not.toThrow();
    expect(() => assertSomethingToUpdate(' ', undefined, 3)).toThrow('Nothing to update.');
  });

  it('hasNameClash ignores case and surrounding spaces', () => {
    expect(hasNameClash([{ name: '  LIDL ' }], 'lidl')).toBe(true);
    expect(hasNameClash([{ name: 'Spar' }], 'lidl')).toBe(false);
  });

  it('deleteOrInUse maps errno 1451 to 409 and rethrows the rest', async () => {
    await expect(deleteOrInUse(() => Promise.reject({ driverError: { errno: 1451 } }))).rejects.toMatchObject({ status: 409 });
    await expect(deleteOrInUse(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(deleteOrInUse(() => Promise.resolve(1))).resolves.toBe(1);
  });
});
