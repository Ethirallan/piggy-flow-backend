import type { Account } from '../account.entity.js';

export class AccountResponseDto {
  id: string;
  name: string;
  /** The user's own account: never shared, can't be deleted. */
  isPersonal: boolean;
  createdAt: Date;
  updatedAt: Date;

  static from(account: Account): AccountResponseDto {
    return {
      id: account.id,
      name: account.name,
      isPersonal: account.isPersonal,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }
}
