import { SnapshotError, toSnapshot } from './v1-snapshot.js';
import { v1Tables } from './testing/v1-tables.js';

const ts = '2026-01-01 10:00:00.000000';

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

  it('reports a missing column once per table', () => {
    const tables = v1Tables({
      shop: [
        { id: '1', name: 'Spar', created: ts, lastUpdate: ts },
        { id: '2', name: 'Mercator', created: ts, lastUpdate: ts },
      ],
    });
    const error: unknown = (() => {
      try {
        toSnapshot(tables);
      } catch (e) {
        return e;
      }
    })();

    expect(
      (error as SnapshotError).problems.filter((p) => p.includes('is missing')),
    ).toEqual(['shop 1: column userId is missing']);
  });

  it('rejects ids that are not integers', () => {
    const tables = v1Tables({
      subscription: [
        {
          id: '1',
          chargeDay: '4.5',
          price: '9.99',
          name: 'Netflix',
          created: ts,
          lastUpdate: ts,
          userId: 'abc',
          accountId: null,
          shopId: null,
          categoryId: null,
        },
      ],
    });

    expect(() => toSnapshot(tables)).toThrow(
      /subscription 1: userId "abc" is not an integer[\s\S]*subscription 1: chargeDay "4\.5" is not an integer/,
    );
  });

  it('rejects NULL in a required text column', () => {
    const tables = v1Tables({
      account: [{ id: '1', name: null, created: ts, lastUpdate: ts }],
    });

    expect(() => toSnapshot(tables)).toThrow('account 1: name is NULL');
  });

  it('rejects a duplicate id within a table', () => {
    const tables = v1Tables({
      shop: [
        { id: '1', name: 'Spar', created: ts, lastUpdate: ts, userId: '1' },
        { id: '1', name: 'Hofer', created: ts, lastUpdate: ts, userId: '1' },
      ],
    });

    expect(() => toSnapshot(tables)).toThrow('shop 1: duplicate id');
  });
});
