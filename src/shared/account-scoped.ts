import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { AccountService } from 'src/account/account.service';
import type { Account } from 'src/account/entities/account.entity';
import { FindOptionsWhere, Repository } from 'typeorm';

/** The `?account=` query value as a number, or undefined when absent. Anything else is 400. */
export function parseAccountQuery(account: string | undefined): number | undefined {
  if (account === undefined) return undefined;
  if (!/^\d+$/.test(account)) throw new BadRequestException('Invalid account.');
  return Number(account);
}

/** The row, if the user belongs to its account. A missing row or one without an account is 404. */
export async function loadAsMember<T extends { id: number; account?: { id: number } | null }>(
  repo: Pick<Repository<T>, 'findOne'>,
  id: number,
  userId: number | undefined,
  accounts: Pick<AccountService, 'assertMember'>,
): Promise<T> {
  if (userId == null) throw new NotFoundException();
  const row = await repo.findOne({ where: { id } as FindOptionsWhere<T>, relations: ['account'] });
  if (!row?.account) throw new NotFoundException();
  await accounts.assertMember(row.account.id, userId);
  return row;
}

/** 400 unless at least one of the values is a non-blank string. */
export function assertSomethingToUpdate(...values: unknown[]): void {
  if (!values.some((v) => typeof v === 'string' && v.trim() !== '')) throw new BadRequestException('Nothing to update.');
}

/** True if a row with the same trimmed, case-insensitive name exists. */
export function hasNameClash(existing: { name: string }[], name: string): boolean {
  const wanted = name.trim().toLowerCase();
  return existing.some((e) => e.name.trim().toLowerCase() === wanted);
}

/** Runs a delete, turning a foreign-key error (ER_ROW_IS_REFERENCED_2) into 409 `In use`. */
export async function deleteOrInUse<R>(remove: () => Promise<R>): Promise<R> {
  try {
    return await remove();
  } catch (e) {
    const error = e as { errno?: number; driverError?: { errno?: number } } | null;
    if (error?.driverError?.errno === 1451 || error?.errno === 1451) throw new ConflictException('In use');
    throw e;
  }
}

/** The rows of one account the user belongs to, or of all their accounts, each with its account. */
export async function listInAccounts<T extends { account?: Account | null }>(
  repo: Pick<Repository<T>, 'find'>,
  accounts: Pick<AccountService, 'assertMember'>,
  userId: number | undefined,
  accountId?: number,
): Promise<T[]> {
  if (accountId !== undefined) {
    await accounts.assertMember(accountId, userId);
    return repo.find({ where: { account: { id: accountId } } as FindOptionsWhere<T>, relations: ['account'] });
  }
  if (userId == null) throw new NotFoundException();
  return repo.find({ where: { account: { users: { id: userId } } } as FindOptionsWhere<T>, relations: ['account'] });
}
