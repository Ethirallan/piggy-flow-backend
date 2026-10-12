import { BadRequestException } from '@nestjs/common';
import { AccountService } from 'src/account/account.service';

/**
 * Checks the `account` a request wants to write a row into.
 *
 * - undefined: allowed, nothing to check (an update that leaves the account alone).
 * - `{ id: <number> }`: the user must be a member, else 404.
 * - anything else (null, a bare id, a string, an array, an object without a
 *   numeric id) is rejected with 400, because TypeORM would write a bare value
 *   straight into the foreign key and skip the membership check.
 */
export async function assertAccountRef(
  account: unknown,
  userId: number | undefined,
  accounts: Pick<AccountService, 'assertMember'>,
): Promise<void> {
  if (account === undefined) return;
  const id = (account as { id?: unknown })?.id;
  if (typeof account !== 'object' || account === null || Array.isArray(account) || !Number.isInteger(id)) {
    throw new BadRequestException('Invalid account.');
  }
  await accounts.assertMember(id as number, userId);
}

/** Like `assertAccountRef`, but a missing account is a 400 too (creates and copies). */
export async function assertRequiredAccountRef(
  account: unknown,
  userId: number | undefined,
  accounts: Pick<AccountService, 'assertMember'>,
): Promise<void> {
  if (account === undefined) throw new BadRequestException('Invalid account.');
  await assertAccountRef(account, userId, accounts);
}
