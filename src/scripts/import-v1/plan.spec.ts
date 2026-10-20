import { toSnapshot } from './v1-snapshot.js';
import { v1Tables } from './testing/v1-tables.js';
import { planImport, PlanError, type V2User } from './plan.js';

const ts = '2026-01-01 10:00:00.000000';
const v2Ana: V2User = {
  id: 'ana',
  email: 'ana@example.com',
  personalAccountId: 'ana-personal',
};
const v2Bob: V2User = {
  id: 'bob',
  email: 'bob@example.com',
  personalAccountId: 'bob-personal',
};
const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};
const bill = (id: number, extra: Record<string, string | null> = {}) => ({
  id: String(id),
  date: '2026-01-01 09:00:00',
  price: '10.00',
  comment: null,
  created: '2026-01-05 10:00:00.000000',
  lastUpdate: ts,
  userId: '1',
  accountId: null,
  shopId: null,
  categoryId: null,
  ...extra,
});
const twoUsers = {
  user: [
    {
      id: '1',
      uid: 'u1',
      email: 'Ana@Example.com',
      displayName: 'Ana',
      created: ts,
      lastUpdate: ts,
    },
    {
      id: '2',
      uid: 'u2',
      email: 'bob@example.com ',
      displayName: 'Bob',
      created: ts,
      lastUpdate: ts,
    },
  ],
};

describe('planImport', () => {
  it('maps users by email, bills without an account to Personal, accounts to new accounts', () => {
    const plan = planImport(
      toSnapshot(
        v1Tables({
          ...twoUsers,
          bill: [
            bill(1),
            bill(2, { accountId: '1', price: '27.62' }),
            bill(3, { userId: '2', price: '-5.00' }),
          ],
          bill_photo: [],
        }),
      ),
      [v2Ana, v2Bob],
      { dismissedEmails: [], today: '2026-10-20', newId: ids() },
    );

    expect(plan.accounts).toEqual([
      {
        id: 'id-1',
        name: 'Car',
        isPersonal: false,
        createdAt: new Date('2026-01-01T10:00:00Z'),
        updatedAt: new Date('2026-01-01T10:00:00Z'),
      },
    ]);
    expect(plan.members).toEqual([
      {
        accountId: 'id-1',
        userId: 'ana',
        joinedAt: new Date('2026-01-01T10:00:00Z'),
      },
    ]);
    expect(
      plan.bills.map((b) => [b.accountId, b.priceCents, b.createdById]),
    ).toEqual([
      ['ana-personal', 1000, 'ana'],
      ['id-1', 2762, 'ana'],
      ['bob-personal', -500, 'bob'],
    ]);
    expect(plan.v1Totals).toEqual({
      perAccount: [
        { accountId: 'ana-personal', bills: 1, cents: 1000 },
        { accountId: 'id-1', bills: 1, cents: 2762 },
        { accountId: 'bob-personal', bills: 1, cents: -500 },
      ],
      perUser: [
        { userId: 'ana', bills: 2, cents: 3762 },
        { userId: 'bob', bills: 1, cents: -500 },
      ],
    });
  });

  it('stops before writing when a user is not registered or a dismissed email is unknown', () => {
    const run = (dismissed: string[]) => () =>
      planImport(toSnapshot(v1Tables(twoUsers)), [v2Ana], {
        dismissedEmails: dismissed,
        today: '2026-10-20',
      });

    expect(run([])).toThrow(PlanError);
    expect(run([])).toThrow(
      'bob@example.com has no v2 account (register, or pass it to --dismiss-users)',
    );
    expect(run(['BOB@example.com'])).not.toThrow();
    expect(run(['bob@example.com', 'carol@example.com'])).toThrow(
      'carol@example.com is not a v1 user',
    );
  });

  it('leaves out a dismissed user’s rows and accounts with no kept member', () => {
    const plan = planImport(
      toSnapshot(
        v1Tables({
          ...twoUsers,
          account: [
            { id: '1', name: 'Car', created: ts, lastUpdate: ts },
            { id: '2', name: 'Boat', created: ts, lastUpdate: ts },
          ],
          user_accounts_account: [
            { userId: '1', accountId: '1' },
            { userId: '2', accountId: '2' },
          ],
          bill: [bill(1), bill(2, { userId: '2', accountId: '2' })],
          bill_photo: [],
          subscription: [],
        }),
      ),
      [v2Ana],
      {
        dismissedEmails: ['bob@example.com'],
        today: '2026-10-20',
        newId: ids(),
      },
    );

    expect(plan.accounts.map((a) => a.name)).toEqual(['Car']);
    expect(plan.bills).toHaveLength(1);
    expect(plan.v1Totals).toEqual({
      perAccount: [{ accountId: 'ana-personal', bills: 1, cents: 1000 }],
      perUser: [{ userId: 'ana', bills: 1, cents: 1000 }],
    });
    expect(plan.report.leftOut).toEqual({
      users: ['bob@example.com'],
      accounts: ['Boat'],
      bills: 1,
      subscriptions: 0,
      photos: 0,
    });
  });

  it('skips zero-price bills, normalises and cuts comments, and keeps photos of kept bills', () => {
    const plan = planImport(
      toSnapshot(
        v1Tables({
          bill: [
            bill(1, { price: '0.00' }),
            bill(2, { comment: `  ${'x'.repeat(1005)} ` }),
            bill(3, { comment: '   ' }),
          ],
          bill_photo: [
            {
              id: '1',
              name: 'dir/IMG 1.jpg',
              path: 'a.jpg',
              blurhash: 'x',
              created: ts,
              billId: '2',
            },
            {
              id: '2',
              name: 'b.jpg',
              path: 'b.jpg',
              blurhash: 'x',
              created: ts,
              billId: '1',
            },
          ],
          subscription: [],
        }),
      ),
      [v2Ana],
      { dismissedEmails: [], today: '2026-10-20', newId: ids() },
    );

    expect(plan.bills.map((b) => b.comment?.length ?? null)).toEqual([
      1000,
      null,
    ]);
    expect(plan.report.fixUps).toContain('bill 1: price 0, skipped');
    expect(plan.v1Totals).toEqual({
      perAccount: [{ accountId: 'ana-personal', bills: 2, cents: 2000 }],
      perUser: [{ userId: 'ana', bills: 2, cents: 2000 }],
    });
    expect(plan.report.fixUps).toContain(
      'bill 2: comment cut to 1000 characters',
    );
    expect(plan.photos).toEqual([
      {
        id: expect.any(String),
        billId: plan.bills[0].id,
        name: 'IMG 1.jpg',
        source: 'a.jpg',
        createdById: 'ana',
        createdAt: new Date('2026-01-01T10:00:00Z'),
      },
    ]);
  });

  it('links subscription charges by name and sets the last charged month', () => {
    const plan = planImport(
      toSnapshot(
        v1Tables({
          bill: [
            bill(1, {
              comment: 'Netflix',
              date: '2026-09-04 06:00:01',
              created: '2026-09-04 06:00:01.100000',
            }),
            bill(2, {
              comment: 'Netflix',
              date: '2026-10-04 06:00:02',
              created: '2026-10-04 06:00:02.100000',
            }),
            bill(3, { comment: 'Netflix', accountId: '1' }), // other account: not a charge
            bill(4, { comment: 'netflix' }), // not exactly the name
            // Mobile entry, read as local: 31 July 22:30 UTC, which is August in Ljubljana.
            bill(5, {
              comment: 'Rent',
              date: '2026-08-01 00:30:00',
              created: '2026-08-03 08:00:00.000000',
            }),
          ],
          bill_photo: [],
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
            {
              id: '2',
              chargeDay: '31',
              price: '5.00',
              name: 'Gym',
              created: ts,
              lastUpdate: ts,
              userId: '1',
              accountId: null,
              shopId: null,
              categoryId: null,
            },
            {
              id: '3',
              chargeDay: '1',
              price: '0.00',
              name: 'Free',
              created: ts,
              lastUpdate: ts,
              userId: '1',
              accountId: null,
              shopId: null,
              categoryId: null,
            },
            {
              id: '4',
              chargeDay: '1',
              price: '500.00',
              name: 'Rent',
              created: ts,
              lastUpdate: ts,
              userId: '1',
              accountId: null,
              shopId: null,
              categoryId: null,
            },
          ],
        }),
      ),
      [v2Ana],
      { dismissedEmails: [], today: '2026-10-20', newId: ids() },
    );

    expect(
      plan.subscriptions.map((s) => [
        s.name,
        s.priceCents,
        s.chargeDay,
        s.lastChargedMonth,
      ]),
    ).toEqual([
      ['Netflix', 999, 4, '2026-10-01'],
      ['Gym', 500, 31, '2026-09-01'], // no match: the new-subscription rule on 20 Oct
      ['Rent', 50000, 1, '2026-08-01'], // the Ljubljana month of the match, not the UTC one
    ]);
    const netflix = plan.subscriptions[0].id;
    const rent = plan.subscriptions[2].id;
    expect(plan.bills.map((b) => b.subscriptionId)).toEqual([
      netflix,
      netflix,
      null,
      null,
      rent,
    ]);
    expect(plan.report.subscriptions[0]).toMatchObject({
      name: 'Netflix',
      matches: 2,
      lastChargedMonth: '2026-10-01',
    });
    expect(plan.report.fixUps).toContain('subscription 3: price 0.00, skipped');
  });

  it('counts the date rules and lists web-era bills whose day depends on the reading', () => {
    const plan = planImport(
      toSnapshot(
        v1Tables({
          bill: [
            bill(1, {
              date: '2026-10-01 23:30:00',
              created: '2026-10-05 08:00:00.000000',
            }),
            // Its day also depends on the reading, but rule 3 before the web app isn't listed.
            bill(2, {
              date: '2025-01-01 23:30:00',
              created: '2025-01-03 08:00:00.000000',
            }),
          ],
          bill_photo: [],
          subscription: [],
        }),
      ),
      [v2Ana],
      { dismissedEmails: [], today: '2026-10-20', newId: ids() },
    );

    expect(plan.report.dateRules).toEqual({
      'same-as-created': 0,
      'local-entry': 0,
      'mobile-era': 1,
      'web-era': 1,
    });
    expect(plan.report.borderline).toEqual([
      {
        billId: 1,
        date: '2026-10-01 23:30:00',
        asUtc: '2026-10-02',
        asLocal: '2026-10-01',
      },
    ]);
  });

  it('stops on a blank account name, a bad charge day and a photo path with a directory', () => {
    const tables = v1Tables({
      account: [{ id: '1', name: '  ', created: ts, lastUpdate: ts }],
      bill_photo: [
        {
          id: '1',
          name: 'a.jpg',
          path: '../a.jpg',
          blurhash: 'x',
          created: ts,
          billId: '1',
        },
      ],
      subscription: [
        {
          id: '1',
          chargeDay: '32',
          price: '1.00',
          name: 'X',
          created: ts,
          lastUpdate: ts,
          userId: '1',
          accountId: null,
          shopId: null,
          categoryId: null,
        },
      ],
    });
    const run = () =>
      planImport(toSnapshot(tables), [v2Ana], {
        dismissedEmails: [],
        today: '2026-10-20',
      });

    expect(run).toThrow('account 1: blank name');
    expect(run).toThrow('subscription 1: charge day 32 is not 1–31');
    expect(run).toThrow('photo 1: path "../a.jpg" is not a plain file name');
  });
});
