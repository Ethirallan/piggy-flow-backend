import { BadRequestException, NotFoundException } from '@nestjs/common';
import { assertAccountRef, assertRequiredAccountRef } from './account-ref';

describe('assertAccountRef', () => {
  const accounts = { assertMember: jest.fn() };
  const check = (account: unknown) => assertAccountRef(account, 7, accounts);

  beforeEach(() => jest.resetAllMocks());

  it('allows undefined (unchanged) without checking membership', async () => {
    await expect(check(undefined)).resolves.toBeUndefined();
    expect(accounts.assertMember).not.toHaveBeenCalled();
  });

  it('checks membership for { id: n }', async () => {
    accounts.assertMember.mockResolvedValue({});
    await check({ id: 77, name: 'x' });
    expect(accounts.assertMember).toHaveBeenCalledWith(77, 7);
  });

  it('gives 404 for a non-member', async () => {
    accounts.assertMember.mockRejectedValue(new NotFoundException());
    await expect(check({ id: 77 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([null, 77, '77', [], [{ id: 77 }], {}, { id: '77' }, { id: null }, { id: 1.5 }, true])(
    'gives 400 Invalid account. for %j',
    async (value) => {
      await expect(check(value)).rejects.toEqual(new BadRequestException('Invalid account.'));
      expect(accounts.assertMember).not.toHaveBeenCalled();
    },
  );
});

describe('assertRequiredAccountRef', () => {
  const accounts = { assertMember: jest.fn() };
  const check = (account: unknown) => assertRequiredAccountRef(account, 7, accounts);

  beforeEach(() => jest.resetAllMocks());

  it.each([undefined, null, 77, {}])('gives 400 Invalid account. for %j', async (value) => {
    await expect(check(value)).rejects.toEqual(new BadRequestException('Invalid account.'));
    expect(accounts.assertMember).not.toHaveBeenCalled();
  });

  it('checks membership for { id: n }', async () => {
    accounts.assertMember.mockResolvedValue({});
    await check({ id: 77 });
    expect(accounts.assertMember).toHaveBeenCalledWith(77, 7);
  });
});
