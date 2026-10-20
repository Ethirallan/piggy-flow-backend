import type { DumpRow } from '../parse-dump.js';

const ts = '2026-01-01 10:00:00.000000';

/** A minimal valid set of tables; override one table per test (`undefined` removes it). */
export function v1Tables(
  overrides: Partial<Record<string, DumpRow[]>> = {},
): Map<string, DumpRow[]> {
  const base: Record<string, DumpRow[] | undefined> = {
    user: [
      {
        id: '1',
        uid: 'u1',
        email: 'Ana@Example.com',
        displayName: 'Ana',
        created: ts,
        lastUpdate: ts,
      },
    ],
    account: [{ id: '1', name: 'Car', created: ts, lastUpdate: ts }],
    user_accounts_account: [{ userId: '1', accountId: '1' }],
    shop: [{ id: '1', name: 'Spar', created: ts, lastUpdate: ts, userId: '1' }],
    category: [
      {
        id: '1',
        name: 'Food',
        created: ts,
        lastUpdate: ts,
        userId: '1',
        emoji: '🍎',
      },
    ],
    bill: [
      {
        id: '1',
        date: '2026-01-01 09:00:00',
        price: '27.62',
        comment: 'Lunch',
        created: ts,
        lastUpdate: ts,
        userId: '1',
        accountId: '1',
        shopId: '1',
        categoryId: '1',
      },
    ],
    bill_photo: [
      {
        id: '1',
        name: 'IMG_1.jpg',
        path: 'a.jpg',
        blurhash: 'x',
        created: ts,
        billId: '1',
      },
    ],
    subscription: [
      {
        id: '1',
        chargeDay: '4',
        price: '9.99',
        name: 'Netflix',
        created: ts,
        lastUpdate: ts,
        userId: '1',
        accountId: null,
        shopId: null,
        categoryId: null,
      },
    ],
  };
  const merged = { ...base, ...overrides };
  return new Map(
    Object.entries(merged).filter(
      (entry): entry is [string, DumpRow[]] => entry[1] !== undefined,
    ),
  );
}
