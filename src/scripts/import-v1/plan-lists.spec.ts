import { toSnapshot } from './v1-snapshot.js';
import { v1Tables } from './testing/v1-tables.js';
import { planLists } from './plan-lists.js';
import { planImport, type V2User } from './plan.js';

const ts = (day: number) =>
  `2026-01-${String(day).padStart(2, '0')} 10:00:00.000000`;
const v2Ana: V2User = {
  id: 'ana',
  email: 'ana@example.com',
  personalAccountId: 'ana-personal',
};
const bill = (
  id: number,
  accountId: string | null,
  shopId: string | null,
  categoryId: string | null = null,
) => ({
  id: String(id),
  date: '2026-01-10 09:00:00',
  price: '1.00',
  comment: null,
  created: '2026-01-12 10:00:00.000000',
  lastUpdate: ts(1),
  userId: '1',
  accountId,
  shopId,
  categoryId,
});
const shop = (id: number, name: string, day: number) => ({
  id: String(id),
  name,
  created: ts(day),
  lastUpdate: ts(day + 1),
  userId: '1',
});

const plan = (overrides: Parameters<typeof v1Tables>[0]) => {
  let n = 0;
  return planImport(
    toSnapshot(v1Tables({ bill_photo: [], subscription: [], ...overrides })),
    [v2Ana],
    {
      dismissedEmails: [],
      today: '2026-10-20',
      newId: () => `id-${++n}`,
    },
  );
};

describe('shops and categories', () => {
  it('copies a shop into every account that uses it and points each bill at its copy', () => {
    const result = plan({
      account: [{ id: '1', name: 'Car', created: ts(1), lastUpdate: ts(1) }],
      shop: [shop(1, 'Spar', 1)],
      category: [],
      bill: [bill(1, null, '1'), bill(2, '1', '1'), bill(3, '1', '1')],
    });

    expect(result.shops.map((s) => [s.accountId, s.name])).toEqual([
      ['ana-personal', 'Spar'],
      ['id-1', 'Spar'],
    ]);
    const [personalSpar, carSpar] = result.shops.map((s) => s.id);
    expect(result.bills.map((b) => b.shopId)).toEqual([
      personalSpar,
      carSpar,
      carSpar,
    ]);
  });

  it('merges same-named shops in one account, keeping the first spelling and the dates range', () => {
    const result = plan({
      shop: [shop(1, 'SPAR', 5), shop(2, ' Spar ', 2), shop(3, 'Lidl', 3)],
      category: [],
      bill: [bill(1, null, '1'), bill(2, null, '2')],
    });

    expect(result.shops.filter((s) => s.name.toLowerCase() === 'spar')).toEqual(
      [
        {
          id: expect.any(String),
          accountId: 'ana-personal',
          name: 'Spar',
          createdAt: new Date('2026-01-02T10:00:00Z'),
          updatedAt: new Date('2026-01-06T10:00:00Z'),
        },
      ],
    );
    expect(new Set(result.bills.map((b) => b.shopId)).size).toBe(1);
    expect(result.report.merged).toEqual([
      { kind: 'shop', accountId: 'ana-personal', name: 'Spar', v1Ids: [2, 1] },
    ]);
  });

  it('puts unused shops and categories in the owner’s Personal account', () => {
    const result = plan({
      shop: [shop(1, 'Unused', 1)],
      category: [
        {
          id: '1',
          name: 'Fun',
          created: ts(1),
          lastUpdate: ts(1),
          userId: '1',
          emoji: '☕️',
        },
      ],
      bill: [],
    });

    expect(result.shops.map((s) => [s.accountId, s.name])).toEqual([
      ['ana-personal', 'Unused'],
    ]);
    expect(
      result.categories.map((c) => [c.accountId, c.name, c.emoji]),
    ).toEqual([['ana-personal', 'Fun', '☕']]);
    expect(result.report.fixUps).toContain('category 1: emoji "☕️" → "☕"');
  });

  it('gives a subscription the shop copy of its account', () => {
    const result = plan({
      account: [{ id: '1', name: 'Car', created: ts(1), lastUpdate: ts(1) }],
      shop: [shop(1, 'Petrol', 1)],
      category: [],
      bill: [],
      subscription: [
        {
          id: '1',
          chargeDay: '1',
          price: '1.00',
          name: 'Wash',
          created: ts(1),
          lastUpdate: ts(1),
          userId: '1',
          accountId: '1',
          shopId: '1',
          categoryId: null,
        },
      ],
    });

    expect(result.shops.map((s) => s.accountId)).toEqual(['id-1']);
    expect(result.subscriptions[0].shopId).toBe(result.shops[0].id);
  });

  it('stops on a blank shop name', () => {
    expect(() =>
      plan({
        shop: [shop(1, '  ', 1)],
        category: [],
        bill: [bill(1, null, '1')],
      }),
    ).toThrow('shop 1: blank name');
  });

  it('merges names that only differ after the 100th character, reporting the cut', () => {
    const long = 'x'.repeat(100);
    const result = plan({
      shop: [shop(1, `${long}A`, 1), shop(2, `${long}B`, 2)],
      category: [],
      bill: [bill(1, null, '1'), bill(2, null, '2')],
    });

    expect(result.shops.map((s) => s.name)).toEqual([long]);
    expect(new Set(result.bills.map((b) => b.shopId))).toEqual(
      new Set([result.shops[0].id]),
    );
    expect(result.report.fixUps.filter((l) => l.includes('name cut'))).toEqual([
      'shop 1: name cut to 100 characters',
      'shop 2: name cut to 100 characters',
    ]);
    expect(result.report.merged).toEqual([
      { kind: 'shop', accountId: 'ana-personal', name: long, v1Ids: [1, 2] },
    ]);
  });

  it('trims again after cutting a name', () => {
    const cut = `${'y'.repeat(99)} z`;
    const result = plan({
      shop: [shop(1, cut, 1)],
      category: [],
      bill: [bill(1, null, '1')],
    });

    expect(result.shops.map((s) => s.name)).toEqual(['y'.repeat(99)]);
  });

  it('drops an unused shop of a dismissed owner', () => {
    const snapshot = toSnapshot(
      v1Tables({
        shop: [shop(1, 'Gone', 1)],
        category: [],
        bill: [],
        bill_photo: [],
        subscription: [],
      }),
    );
    const report = { merged: [], fixUps: [] } as unknown as Parameters<
      typeof planLists
    >[4];
    const lists = planLists(
      snapshot,
      [],
      () => null,
      () => 'x',
      report,
      [],
    );
    expect(lists.shops).toEqual([]);
  });

  it('keeps the first category’s emoji when categories merge', () => {
    const category = (
      id: number,
      name: string,
      day: number,
      emoji: string,
    ) => ({
      id: String(id),
      name,
      created: ts(day),
      lastUpdate: ts(day),
      userId: '1',
      emoji,
    });
    const result = plan({
      shop: [],
      category: [category(1, 'Food', 5, '🍎'), category(2, 'FOOD', 2, '🍕')],
      bill: [bill(1, null, null, '1')],
    });

    expect(result.categories.map((c) => [c.name, c.emoji])).toEqual([
      ['FOOD', '🍕'],
    ]);
  });

  it('stops on a blank category name', () => {
    expect(() =>
      plan({
        shop: [],
        category: [
          {
            id: '1',
            name: ' ',
            created: ts(1),
            lastUpdate: ts(1),
            userId: '1',
            emoji: null,
          },
        ],
        bill: [],
      }),
    ).toThrow('category 1: blank name');
  });
});
