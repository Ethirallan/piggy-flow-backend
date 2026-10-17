import type { Account } from './account.entity.js';

/** Personal first, then by name ignoring case, then oldest first. */
export function compareAccounts(a: Account, b: Account): number {
  return (
    Number(b.isPersonal) - Number(a.isPersonal) ||
    a.name.localeCompare(b.name, 'en', { sensitivity: 'accent' }) ||
    a.createdAt.getTime() - b.createdAt.getTime()
  );
}
