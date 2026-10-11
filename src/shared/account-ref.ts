import { BadRequestException } from '@nestjs/common';
import { AccountService } from 'src/account/account.service';

/**
 * Checks the `account` a request wants to write a bill or subscription into.
 *
 * - undefined or null: allowed (personal, for now).
 * - `{ id: <number> }`: the user must be a member, else 404.
 * - anything else (a bare id, a string, an array, an object without a numeric
 *   id) is rejected with 400, because TypeORM would write a bare value
 *   straight into the foreign key and skip the membership check.
 */
export async function assertAccountRef(
  account: unknown,
  userId: number | undefined,
  accounts: Pick<AccountService, 'assertMember'>,
): Promise<void> {
  if (account === undefined || account === null) return;
  const id = (account as { id?: unknown })?.id;
  if (typeof account !== 'object' || Array.isArray(account) || !Number.isInteger(id)) {
    throw new BadRequestException('Invalid account.');
  }
  await accounts.assertMember(id as number, userId);
}
