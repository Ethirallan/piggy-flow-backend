import { compareAccounts } from './account-order.js';
import type { Account } from './account.entity.js';

const account = (
  name: string,
  createdAt: string,
  isPersonal = false,
): Account => ({
  id: name,
  name,
  isPersonal,
  createdAt: new Date(createdAt),
  updatedAt: new Date(createdAt),
});

describe('compareAccounts', () => {
  it('puts Personal first, then sorts by name ignoring case, then oldest first', () => {
    const accounts = [
      account('zoo', '2026-10-01'),
      account('Home', '2026-10-03'),
      account('home', '2026-10-02'),
      account('Personal', '2026-10-04', true),
      account('Apartment', '2026-10-05'),
    ];

    expect(
      accounts
        .sort(compareAccounts)
        .map((a) => `${a.name} ${a.createdAt.getDate()}`),
    ).toEqual(['Personal 4', 'Apartment 5', 'home 2', 'Home 3', 'zoo 1']);
  });
});
