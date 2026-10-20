import type { DumpRow } from './parse-dump.js';
import { SnapshotError, toSnapshot } from './v1-snapshot.js';

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

describe('toSnapshot', () => {
  it('types every table', () => {
    const snapshot = toSnapshot(v1Tables());

    expect(snapshot.users).toEqual([
      { id: 1, email: 'Ana@Example.com', displayName: 'Ana' },
    ]);
    expect(snapshot.memberships).toEqual([{ userId: 1, accountId: 1 }]);
    expect(snapshot.bills[0]).toEqual({
      id: 1,
      userId: 1,
      accountId: 1,
      shopId: 1,
      categoryId: 1,
      date: '2026-01-01 09:00:00',
      price: '27.62',
      comment: 'Lunch',
      created: ts,
      lastUpdate: ts,
    });
    expect(snapshot.subscriptions[0]).toMatchObject({
      chargeDay: 4,
      accountId: null,
      name: 'Netflix',
    });
    expect(snapshot.photos[0]).toEqual({
      id: 1,
      billId: 1,
      name: 'IMG_1.jpg',
      path: 'a.jpg',
      created: ts,
    });
  });

  it('lists every problem at once', () => {
    const error: unknown = (() => {
      try {
        toSnapshot(
          v1Tables({
            bill: [
              {
                id: '1',
                date: '2026-01-01 09:00:00',
                price: '1.00',
                comment: null,
                created: ts,
                lastUpdate: ts,
                userId: '9',
                accountId: '8',
                shopId: '7',
                categoryId: null,
              },
            ],
            bill_photo: [],
            subscription: undefined,
          }),
        );
      } catch (e) {
        return e;
      }
    })();

    expect(error).toBeInstanceOf(SnapshotError);
    expect((error as SnapshotError).problems).toEqual([
      'table subscription is missing',
      'bill 1: user 9 does not exist',
      'bill 1: account 8 does not exist',
      'bill 1: shop 7 does not exist',
    ]);
  });

  it('rejects a missing column', () => {
    const tables = v1Tables({
      shop: [{ id: '1', name: 'Spar', created: ts, lastUpdate: ts }],
    });

    expect(() => toSnapshot(tables)).toThrow(
      'shop 1: column userId is missing',
    );
  });
});
