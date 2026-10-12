import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AccountsStore,
  ListRow,
  RefRow,
  RefTable,
  Table,
  UserRow,
  plannedDuplicates,
  planMigration,
  rollback,
  runMigration,
  verify,
} from './account-migration';

type Acc = { id: number; name: string; personal: boolean; members: number[] };
type Data = {
  users: UserRow[];
  accounts: Acc[];
  bill: RefRow[];
  subscription: RefRow[];
  shop: ListRow[];
  category: ListRow[];
};

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

class MemStore implements AccountsStore {
  data: Data;
  /**
   * 'false': the conditional write matches no row. 'throw': it fails without
   * writing. 'commit-throw': it writes, then fails (connection lost after commit).
   */
  onWrite?: (
    method: string,
    id: number,
  ) => 'false' | 'throw' | 'commit-throw' | void;

  constructor(data: Partial<Data>) {
    this.data = copy({
      users: [],
      accounts: [],
      bill: [],
      subscription: [],
      shop: [],
      category: [],
      ...data,
    });
  }

  private cond(
    method: string,
    id: number,
    matches: boolean,
    write: () => void,
  ): boolean {
    const h = this.onWrite?.(method, id);
    if (h === 'throw') throw new Error(`${method} failed on ${id}`);
    if (h === 'false' || !matches) return false;
    write();
    if (h === 'commit-throw') throw new Error(`${method} lost after commit`);
    return true;
  }

  private nextId(rows: { id: number }[]) {
    return Math.max(0, ...rows.map((r) => r.id)) + 1;
  }

  async users() {
    return copy(this.data.users);
  }
  async personalAccounts() {
    return this.data.accounts
      .filter((a) => a.personal)
      .flatMap((a) =>
        a.members.map((userId) => ({ accountId: a.id, userId, name: a.name })),
      );
  }
  async refs(table: RefTable) {
    return copy(this.data[table]);
  }
  async lists(table: Table) {
    return copy(this.data[table]);
  }
  async createPersonal(userId: number) {
    const id = this.nextId(this.data.accounts);
    this.data.accounts.push({
      id,
      name: 'Personal',
      personal: true,
      members: [userId],
    });
    return id;
  }
  async clearPersonal(accountId: number, expectedName: string) {
    const a = this.data.accounts.find((x) => x.id === accountId);
    return this.cond(
      'clearPersonal',
      accountId,
      a?.personal && a.name === expectedName,
      () => Object.assign(a, { personal: false, name: 'Personal (duplicate)' }),
    );
  }
  async restorePersonal(accountId: number, name: string) {
    const a = this.data.accounts.find((x) => x.id === accountId);
    return this.cond(
      'restorePersonal',
      accountId,
      a && !a.personal && a.name === 'Personal (duplicate)',
      () => Object.assign(a, { personal: true, name }),
    );
  }
  async setRefAccount(
    table: RefTable,
    id: number,
    expected: number | null,
    accountId: number | null,
  ) {
    const r = this.data[table].find((x) => x.id === id);
    return this.cond('setRefAccount', id, r?.accountId === expected, () => {
      r.accountId = accountId;
    });
  }
  async setListAccount(
    table: Table,
    id: number,
    expected: number | null,
    accountId: number | null,
  ) {
    const r = this.data[table].find((x) => x.id === id);
    return this.cond('setListAccount', id, r?.accountId === expected, () => {
      r.accountId = accountId;
    });
  }
  async insertListCopy(table: Table, source: ListRow, accountId: number) {
    const id = this.nextId(this.data[table]);
    this.data[table].push({ ...source, id, accountId });
    return id;
  }
  async repoint(
    table: RefTable,
    id: number,
    field: 'shopId' | 'categoryId',
    expected: number,
    newId: number,
  ) {
    const r = this.data[table].find((x) => x.id === id);
    return this.cond('repoint', id, r?.[field] === expected, () => {
      r[field] = newId;
    });
  }

  personalOf(userId: number) {
    return this.data.accounts.filter(
      (a) => a.personal && a.members.includes(userId),
    );
  }
}

const bill = (
  id: number,
  userId: number,
  accountId: number | null,
  shopId: number | null = null,
  price = 10,
): RefRow => ({
  id,
  userId,
  accountId,
  shopId,
  categoryId: null,
  price,
});

let logFile: string;
beforeEach(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'account-mig-'));
  logFile = path.join(dir, '.migration', 'accounts.jsonl');
});

const readLog = async () =>
  (await fs.readFile(logFile, 'utf8'))
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

describe('account migration: Personal accounts and references', () => {
  it('plans without writing anything', async () => {
    const store = new MemStore({
      users: [{ id: 1 }, { id: 2 }],
      accounts: [
        { id: 10, name: 'Personal', personal: true, members: [2] },
        { id: 11, name: 'Personal', personal: true, members: [2] },
      ],
      bill: [bill(1, 1, null, 1), bill(2, 2, 11)],
      shop: [{ id: 1, userId: 1, accountId: null, name: 'Lidl' }],
    });
    const before = copy(store.data);
    const plan = await planMigration(store);
    expect(plan.length).toBeGreaterThan(0);
    expect(store.data).toEqual(before);
  });

  it('gives a user with no rows a Personal account', async () => {
    const store = new MemStore({ users: [{ id: 1 }] });
    expect(await planMigration(store)).toEqual([
      { kind: 'personal', userId: 1 },
    ]);
    await runMigration(store, logFile);
    expect(store.personalOf(1)).toHaveLength(1);
  });

  it('moves a bill with a null account to the Personal account', async () => {
    const store = new MemStore({
      users: [{ id: 1 }],
      bill: [bill(1, 1, null)],
      subscription: [
        { id: 5, userId: 1, accountId: null, shopId: null, categoryId: null },
      ],
    });
    const res = await runMigration(store, logFile);
    const personal = store.personalOf(1)[0].id;
    expect(store.data.bill[0].accountId).toBe(personal);
    expect(store.data.subscription[0].accountId).toBe(personal);
    expect(res).toEqual({ applied: 3, skipped: [] });
  });

  it('applies nothing on a second run', async () => {
    const store = new MemStore({
      users: [{ id: 1 }, { id: 2 }],
      accounts: [
        { id: 7, name: 'Household', personal: false, members: [1, 2] },
      ],
      bill: [bill(1, 1, null), bill(2, 2, 7)],
    });
    expect((await runMigration(store, logFile)).applied).toBeGreaterThan(0);
    expect(await planMigration(store)).toEqual([]);
    expect(await runMigration(store, logFile)).toEqual({
      applied: 0,
      skipped: [],
    });
  });

  it('writes the totals line first, before any write', async () => {
    const store = new MemStore({
      users: [{ id: 1 }, { id: 2 }],
      bill: [
        bill(1, 1, null, null, 10.1),
        bill(2, 1, null, null, 0.2),
        bill(3, 2, null, null, 5),
      ],
    });
    await runMigration(store, logFile);
    const log = await readLog();
    expect(log[0]).toEqual({
      kind: 'totals',
      perUser: { '1': { bills: 2, sum: 10.3 }, '2': { bills: 1, sum: 5 } },
    });
    expect(log.slice(1).map((l) => l.kind)).toEqual([
      'applied',
      'applied',
      'intent',
      'applied',
      'intent',
      'applied',
      'intent',
      'applied',
    ]);
    expect(log[1]).toEqual({
      kind: 'applied',
      action: { kind: 'personal', userId: 1, newId: 1 },
    });
    const ref = {
      kind: 'ref-account',
      table: 'bill',
      id: 1,
      from: null,
      to: 1,
    };
    expect(log.slice(3, 5)).toEqual([
      { kind: 'intent', action: ref },
      { kind: 'applied', action: ref },
    ]);

    await runMigration(store, logFile); // appending to an existing log adds no second totals line
    expect((await readLog()).filter((l) => l.kind === 'totals')).toHaveLength(
      1,
    );
  });

  it('logs a false conditional write as skipped and continues', async () => {
    const store = new MemStore({
      users: [{ id: 1 }],
      bill: [bill(1, 1, null), bill(2, 1, null)],
    });
    store.onWrite = (method, id) =>
      method === 'setRefAccount' && id === 1 ? 'false' : undefined;
    const res = await runMigration(store, logFile);
    const skipped = {
      kind: 'ref-account',
      table: 'bill',
      id: 1,
      from: null,
      to: 1,
    };
    expect(res).toEqual({ applied: 2, skipped: [skipped] });
    expect(store.data.bill[1].accountId).toBe(1);
    const moved = { ...skipped, id: 2 };
    expect((await readLog()).slice(1)).toEqual([
      {
        kind: 'applied',
        action: { kind: 'personal', userId: 1, newId: 1 },
      },
      { kind: 'intent', action: skipped },
      {
        kind: 'skipped',
        reason: 'conditional write matched no row',
        action: skipped,
      },
      { kind: 'intent', action: moved },
      { kind: 'applied', action: moved },
    ]);
  });

  describe('duplicate Personal accounts', () => {
    const twoPersonals = () =>
      new MemStore({
        users: [{ id: 1 }],
        accounts: [
          { id: 4, name: 'Personal', personal: true, members: [1] },
          { id: 3, name: 'Personal', personal: true, members: [1] },
        ],
        bill: [bill(1, 1, 3, 1), bill(2, 1, 4, 2)],
        shop: [
          { id: 1, userId: 1, accountId: 3, name: 'Lidl' },
          { id: 2, userId: 1, accountId: 4, name: 'Spar' },
        ],
      });

    it('keeps the lowest id and moves the rest into it, before anything else', async () => {
      const store = twoPersonals();
      const plan = await planMigration(store);
      expect(plan).toEqual([
        { kind: 'dedupe-move', table: 'bill', id: 2, from: 4, to: 3 },
        { kind: 'dedupe-move', table: 'shop', id: 2, from: 4, to: 3 },
        {
          kind: 'dedupe-personal',
          userId: 1,
          keep: 3,
          extra: 4,
          name: 'Personal',
        },
      ]);
      const res = await runMigration(store, logFile);
      expect(res).toEqual({ applied: 3, skipped: [] });
      expect(store.personalOf(1).map((a) => a.id)).toEqual([3]);
      expect(store.data.bill.map((b) => b.accountId)).toEqual([3, 3]);
      expect(store.data.shop.map((s) => s.accountId)).toEqual([3, 3]);
      expect(store.data.accounts.find((a) => a.id === 4)).toEqual({
        id: 4,
        name: 'Personal (duplicate)',
        personal: false,
        members: [1],
      });
      expect(await runMigration(store, logFile)).toEqual({
        applied: 0,
        skipped: [],
      });
    });

    it('keeps the duplicate Personal when one of its rows could not be moved', async () => {
      const store = twoPersonals();
      store.onWrite = (method, id) =>
        method === 'setRefAccount' && id === 2 ? 'false' : undefined;
      const res = await runMigration(store, logFile);
      expect(res.skipped.map((a) => a.kind)).toEqual([
        'dedupe-move',
        'dedupe-personal',
      ]);
      expect(store.personalOf(1).map((a) => a.id)).toEqual([4, 3]);
    });

    it('converges after a throw partway through the moves, demoting the extra only at the end', async () => {
      const straight = twoPersonals();
      await runMigration(straight, logFile + '.straight');

      const store = twoPersonals();
      store.onWrite = (method) =>
        method === 'setListAccount' ? 'throw' : undefined;
      await expect(runMigration(store, logFile)).rejects.toThrow(
        'setListAccount failed',
      );
      expect(store.data.bill.map((b) => b.accountId)).toEqual([3, 3]);
      expect(store.data.shop.map((s) => s.accountId)).toEqual([3, 4]);
      expect(store.personalOf(1).map((a) => a.id)).toEqual([4, 3]);

      store.onWrite = undefined;
      expect(await planMigration(store)).toEqual([
        { kind: 'dedupe-move', table: 'shop', id: 2, from: 4, to: 3 },
        {
          kind: 'dedupe-personal',
          userId: 1,
          keep: 3,
          extra: 4,
          name: 'Personal',
        },
      ]);
      await runMigration(store, logFile);
      expect(store.data).toEqual(straight.data);
      expect(await planMigration(store)).toEqual([]);
    });

    it('leaves a Personal account shared with another user unchanged and never targets it', async () => {
      const store = new MemStore({
        users: [{ id: 1 }, { id: 2 }],
        accounts: [
          { id: 3, name: 'Personal', personal: true, members: [1] },
          { id: 4, name: 'Personal', personal: true, members: [1, 2] },
        ],
        bill: [bill(1, 2, null), bill(2, 1, 4)],
      });
      expect(await planMigration(store)).toEqual([
        {
          kind: 'skip',
          table: 'account',
          id: 4,
          reason: 'Personal account shared by users 1, 2; left unchanged',
        },
        { kind: 'personal', userId: 2 },
        { kind: 'ref-account', table: 'bill', id: 1, from: null, to: -2 },
      ]);
      await runMigration(store, logFile);
      expect(store.data.accounts.find((a) => a.id === 4).personal).toBe(true);
      expect(store.data.bill.map((b) => b.accountId)).toEqual([5, 4]);
    });
  });

  it('logs the intent even when the write commits and then throws', async () => {
    const store = new MemStore({
      users: [{ id: 1 }],
      bill: [bill(1, 1, null)],
    });
    store.onWrite = (method) =>
      method === 'setRefAccount' ? 'commit-throw' : undefined;
    await expect(runMigration(store, logFile)).rejects.toThrow(
      'lost after commit',
    );
    expect(store.data.bill[0].accountId).toBe(1);
    expect((await readLog()).slice(1)).toEqual([
      { kind: 'applied', action: { kind: 'personal', userId: 1, newId: 1 } },
      {
        kind: 'intent',
        action: {
          kind: 'ref-account',
          table: 'bill',
          id: 1,
          from: null,
          to: 1,
        },
      },
    ]);
    store.onWrite = undefined;
    expect(await planMigration(store)).toEqual([]);
  });
});

describe('account migration: shops and categories', () => {
  const P = 1; // user 1's Personal
  const H = 2; // Household: users 1 and 2
  const accounts = (): Acc[] => [
    { id: P, name: 'Personal', personal: true, members: [1] },
    { id: H, name: 'Household', personal: false, members: [1, 2] },
    { id: 3, name: 'Personal', personal: true, members: [2] },
  ];
  const lidl = (accountId: number | null = null): ListRow => ({
    id: 1,
    userId: 1,
    accountId,
    name: 'Lidl',
    emoji: '🛒',
  });
  const sub = (
    id: number,
    accountId: number,
    shopId: number,
    categoryId: number | null = null,
  ): RefRow => ({
    id,
    userId: 1,
    accountId,
    shopId,
    categoryId,
  });

  it('keeps a shop used only in Personal there', async () => {
    const store = new MemStore({
      users: [{ id: 1 }],
      accounts: accounts(),
      bill: [bill(1, 1, P, 1), bill(2, 1, null, 1)],
      shop: [lidl()],
    });
    await runMigration(store, logFile);
    expect(store.data.shop).toEqual([lidl(P)]);
    expect(store.data.bill.map((b) => [b.accountId, b.shopId])).toEqual([
      [P, 1],
      [P, 1],
    ]);
  });

  it("moves an unused shop to its creator's Personal, created in the same run", async () => {
    const store = new MemStore({ users: [{ id: 1 }], shop: [lidl()] });
    expect(await planMigration(store)).toEqual([
      { kind: 'personal', userId: 1 },
      { kind: 'list-account', table: 'shop', id: 1, from: null, to: -1 },
    ]);
    await runMigration(store, logFile);
    expect(store.data.shop[0].accountId).toBe(store.personalOf(1)[0].id);
  });

  it('keeps a shop in Personal (3 bills) and copies it for its Household bill', async () => {
    const store = new MemStore({
      users: [{ id: 1 }, { id: 2 }],
      accounts: accounts(),
      bill: [
        bill(1, 1, P, 1),
        bill(2, 1, P, 1),
        bill(3, 1, P, 1),
        bill(4, 2, H, 1),
      ],
      shop: [lidl()],
    });
    const res = await runMigration(store, logFile);
    expect(store.data.shop).toEqual([lidl(P), { ...lidl(H), id: 2 }]);
    expect(store.data.bill.map((b) => b.shopId)).toEqual([1, 1, 1, 2]);
    expect(res).toEqual({ applied: 3, skipped: [] });
    const move = {
      kind: 'list-account',
      table: 'shop',
      id: 1,
      from: null,
      to: P,
    };
    const repoint = {
      kind: 'repoint',
      table: 'bill',
      id: 4,
      field: 'shopId',
      from: 1,
      to: 2,
    };
    expect((await readLog()).slice(1)).toEqual([
      { kind: 'intent', action: move },
      { kind: 'applied', action: move },
      {
        kind: 'applied',
        action: {
          kind: 'copy',
          table: 'shop',
          sourceId: 1,
          to: H,
          refs: [{ table: 'bill', id: 4 }],
          newId: 2,
        },
      },
      { kind: 'intent', action: repoint },
      { kind: 'applied', action: repoint },
    ]);
    expect(await runMigration(store, logFile)).toEqual({
      applied: 0,
      skipped: [],
    });
  });

  it('splits a shop and a category used only by a subscription in another account', async () => {
    const store = new MemStore({
      users: [{ id: 1 }, { id: 2 }],
      accounts: accounts(),
      bill: [bill(1, 1, P, 1)],
      subscription: [sub(1, H, 1, 1)],
      shop: [lidl()],
      category: [
        { id: 1, userId: 1, accountId: null, name: 'Food', emoji: null },
      ],
    });
    await runMigration(store, logFile);
    expect(store.data.shop.map((s) => [s.id, s.accountId])).toEqual([
      [1, P],
      [2, H],
    ]);
    // The category has only the Household subscription, so it moves there whole.
    expect(store.data.category.map((c) => [c.id, c.accountId])).toEqual([
      [1, H],
    ]);
    expect(store.data.subscription[0]).toMatchObject({
      shopId: 2,
      categoryId: 1,
    });
    expect(store.data.bill[0]).toMatchObject({ shopId: 1 });
  });

  it('prefers Personal on a tie, then the lowest account id', async () => {
    const store = new MemStore({
      users: [{ id: 1 }, { id: 2 }],
      accounts: [
        { id: 1, name: 'Household', personal: false, members: [1, 2] },
        { id: 2, name: 'Work', personal: false, members: [1] },
        { id: 3, name: 'Personal', personal: true, members: [1] },
        { id: 4, name: 'Personal', personal: true, members: [2] },
      ],
      bill: [
        bill(1, 1, 1, 1),
        bill(2, 1, 3, 1),
        bill(3, 1, 1, 2),
        bill(4, 1, 2, 2),
      ],
      shop: [lidl(), { ...lidl(), id: 2, name: 'Spar' }],
    });
    await runMigration(store, logFile);
    expect(store.data.shop.map((s) => [s.id, s.accountId])).toEqual([
      [1, 3],
      [2, 1],
      [3, 1],
      [4, 2],
    ]);
  });

  it('reuses the copy after a run stopped before its references were repointed', async () => {
    const store = new MemStore({
      users: [{ id: 1 }, { id: 2 }],
      accounts: accounts(),
      bill: [
        bill(1, 1, P, 1),
        bill(2, 1, P, 1),
        bill(3, 2, H, 1),
        bill(4, 2, H, 1),
      ],
      subscription: [sub(1, H, 1)],
      shop: [lidl(P)],
    });
    let repoints = 0;
    store.onWrite = (method) =>
      method === 'repoint' && ++repoints === 2 ? 'throw' : undefined;
    await expect(runMigration(store, logFile)).rejects.toThrow(
      'repoint failed',
    );
    expect(store.data.shop).toHaveLength(2);

    store.onWrite = undefined;
    expect(await planMigration(store)).toEqual([
      {
        kind: 'repoint',
        table: 'bill',
        id: 4,
        field: 'shopId',
        from: 1,
        to: 2,
      },
      {
        kind: 'repoint',
        table: 'subscription',
        id: 1,
        field: 'shopId',
        from: 1,
        to: 2,
      },
    ]);
    await runMigration(store, logFile);
    expect(store.data.shop).toEqual([lidl(P), { ...lidl(H), id: 2 }]);
    expect(store.data.bill.map((b) => b.shopId)).toEqual([1, 1, 2, 2]);
    expect(store.data.subscription[0].shopId).toBe(2);
    expect(await runMigration(store, logFile)).toEqual({
      applied: 0,
      skipped: [],
    });
  });

  it('reuses a copy that has no references left, without moving it to Personal', async () => {
    const store = new MemStore({
      users: [{ id: 1 }],
      accounts: accounts(),
      bill: [bill(1, 1, P, 1), bill(2, 1, H, 1)],
      shop: [lidl(P), { ...lidl(H), id: 2, name: ' lidl ' }],
    });
    expect(await planMigration(store)).toEqual([
      {
        kind: 'repoint',
        table: 'bill',
        id: 2,
        field: 'shopId',
        from: 1,
        to: 2,
      },
    ]);
  });

  it('leaves an unreferenced shop without a creator unchanged and reports it', async () => {
    const orphan: ListRow = {
      id: 1,
      userId: null,
      accountId: null,
      name: 'Old',
    };
    const store = new MemStore({
      users: [{ id: 1 }],
      accounts: accounts(),
      shop: [orphan],
    });
    const res = await runMigration(store, logFile);
    expect(res.skipped).toEqual([
      {
        kind: 'skip',
        table: 'shop',
        id: 1,
        reason: 'no creator and no references',
      },
    ]);
    expect(store.data.shop).toEqual([orphan]);
  });

  it('keeps the winner stable when a Personal account is created in the same run', async () => {
    const setup = () =>
      new MemStore({
        users: [{ id: 1 }, { id: 2 }],
        accounts: [{ id: 7, name: 'Personal', personal: true, members: [2] }],
        bill: [bill(1, 1, null, 1), bill(2, 2, 7, 1)],
        shop: [{ ...lidl(), userId: 2 }],
      });
    const straight = setup();
    await runMigration(straight, logFile + '.straight');

    const store = setup();
    store.onWrite = (method) => (method === 'repoint' ? 'throw' : undefined);
    await expect(runMigration(store, logFile)).rejects.toThrow(
      'repoint failed',
    );
    store.onWrite = undefined;
    await runMigration(store, logFile);

    expect(store.data.shop).toEqual([
      { ...lidl(7), userId: 2 },
      { ...lidl(8), userId: 2, id: 2 },
    ]);
    expect(store.data.bill.map((b) => [b.accountId, b.shopId])).toEqual([
      [8, 2],
      [7, 1],
    ]);
    expect(await planMigration(store)).toEqual([]);
    expect(store.data).toEqual(straight.data);
  });

  it('gives a subscription-only tie (0 bills each) to Personal', async () => {
    const store = new MemStore({
      users: [{ id: 1 }],
      accounts: [
        { id: 1, name: 'Household', personal: false, members: [1] },
        { id: 2, name: 'Personal', personal: true, members: [1] },
      ],
      subscription: [sub(1, 1, 1), sub(2, 2, 1)],
      shop: [lidl()],
    });
    await runMigration(store, logFile);
    expect(store.data.shop.map((s) => [s.id, s.accountId])).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(store.data.subscription.map((x) => x.shopId)).toEqual([2, 1]);
    expect(await planMigration(store)).toEqual([]);
  });

  it('keeps a shop in its current account on a tie between shared accounts', async () => {
    const store = new MemStore({
      users: [{ id: 1 }],
      accounts: [
        { id: 1, name: 'Work', personal: false, members: [1] },
        { id: 2, name: 'Household', personal: false, members: [1] },
        { id: 3, name: 'Personal', personal: true, members: [1] },
      ],
      bill: [bill(1, 1, 1, 1), bill(2, 1, 2, 1)],
      shop: [lidl(2)],
    });
    expect(await planMigration(store)).toEqual([
      {
        kind: 'copy',
        table: 'shop',
        sourceId: 1,
        to: 1,
        refs: [{ table: 'bill', id: 1 }],
      },
    ]);
  });
});

describe('account migration: verify, rollback and duplicates', () => {
  const lidl = (id: number, accountId: number | null, userId = 1): ListRow => ({
    id,
    userId,
    accountId,
    name: 'Lidl',
  });
  const household = (): Partial<Data> => ({
    users: [{ id: 1 }, { id: 2 }],
    accounts: [
      { id: 1, name: 'Personal', personal: true, members: [1] },
      { id: 2, name: 'Household', personal: false, members: [1, 2] },
    ],
    bill: [bill(1, 1, null, 1), bill(2, 1, 1, 1), bill(3, 2, 2, 1, 7.5)],
    subscription: [
      { id: 1, userId: 2, accountId: null, shopId: null, categoryId: null },
    ],
    shop: [lidl(1, null)],
  });

  it('passes verify after a run', async () => {
    const store = new MemStore(household());
    await runMigration(store, logFile);
    expect(await verify(store, [logFile])).toEqual({ ok: true, problems: [] });
  });

  it('reports each kind of problem', async () => {
    const store = new MemStore(household());
    await runMigration(store, logFile);
    store.data.subscription[0].accountId = null;
    store.data.bill[2].accountId = 1; // its shop copy is in Household
    store.data.accounts.push({
      id: 9,
      name: 'Personal',
      personal: true,
      members: [1],
    });
    store.data.users.push({ id: 5 });
    store.data.bill.push(bill(4, 2, 2, null, 3));
    const shopOf3 = store.data.bill[2].shopId;
    expect((await verify(store, [logFile])).problems).toEqual([
      'subscription 1 has no account',
      `bill 3 is in account 1 but its shop ${shopOf3} is in account 2`,
      'user 1 has 2 Personal accounts (1, 9)',
      'user 5 has 0 Personal accounts',
      'user 2: 1 bills totalling 7.5 at the first run, now 2 totalling 10.5',
    ]);
  });

  it('compares with the earliest totals line and fails without one', async () => {
    const dir = path.dirname(logFile);
    const store = new MemStore({
      users: [{ id: 1 }],
      bill: [bill(1, 1, null)],
    });
    const first = path.join(dir, 'accounts-2026-01-01.jsonl');
    const second = path.join(dir, 'accounts-2026-02-01.jsonl');
    await runMigration(store, first);
    store.data.bill.push(bill(2, 1, 1));
    await runMigration(store, second);
    expect((await verify(store, [second, first])).problems).toEqual([
      'user 1: 1 bills totalling 10 at the first run, now 2 totalling 20',
    ]);
    expect((await verify(store, [])).problems).toEqual([
      'no totals line in the logs, so bill totals were not compared',
    ]);
  });

  it('rolls back every logged write, keeping created accounts and copies', async () => {
    const store = new MemStore({
      ...household(),
      accounts: [
        { id: 1, name: 'Personal', personal: true, members: [1] },
        { id: 2, name: 'Household', personal: false, members: [1, 2] },
        { id: 3, name: 'Old Personal', personal: true, members: [1] },
      ],
      category: [{ id: 1, userId: 1, accountId: 3, name: 'Food' }],
    });
    const before = copy(store.data);
    await runMigration(store, logFile);
    expect(store.data.accounts[2].personal).toBe(false);
    const res = await rollback(store, [logFile]);
    expect(res.skipped).toBe(0);
    expect(res.restored).toBeGreaterThan(0);
    expect(store.data.bill).toEqual(before.bill);
    expect(store.data.subscription).toEqual(before.subscription);
    expect(store.data.category).toEqual(before.category);
    expect(store.data.shop[0]).toEqual(before.shop[0]);
    expect(store.data.shop.length).toBeGreaterThan(1); // the copy stays
    expect(store.data.accounts.slice(0, 3)).toEqual(before.accounts);
    expect(store.data.accounts.length).toBeGreaterThan(3); // user 2's Personal stays
  });

  it('skips rows changed since the run and restores the rest', async () => {
    const store = new MemStore(household());
    await runMigration(store, logFile);
    store.data.bill[0].accountId = 2; // the user moved it
    const res = await rollback(store, [logFile]);
    expect(res.skipped).toBe(1);
    expect(store.data.bill[0].accountId).toBe(2);
    expect(store.data.subscription[0].accountId).toBeNull();
    expect(await rollback(store, [logFile])).toEqual({
      restored: 0,
      skipped: res.restored + res.skipped,
    });
  });

  it('undoes several logs newest first, also from intents without an outcome', async () => {
    const dir = path.dirname(logFile);
    const first = path.join(dir, 'accounts-1.jsonl');
    const second = path.join(dir, 'accounts-2.jsonl');
    const store = new MemStore({
      users: [{ id: 1 }],
      accounts: [{ id: 1, name: 'Personal', personal: true, members: [1] }],
      bill: [bill(1, 1, null)],
      shop: [lidl(1, null)],
    });
    store.onWrite = (method) =>
      method === 'setListAccount' ? 'commit-throw' : undefined;
    await expect(runMigration(store, first)).rejects.toThrow(/after commit/);
    expect(store.data.shop[0].accountId).toBe(1);
    store.onWrite = undefined;
    store.data.bill.push(bill(2, 1, null));
    await runMigration(store, second);
    expect(await rollback(store, [first, second])).toEqual({
      restored: 3,
      skipped: 0,
    });
    expect(store.data.bill.map((b) => b.accountId)).toEqual([null, null]);
    expect(store.data.shop[0].accountId).toBeNull();
  });

  it('lists same-name shops the plan puts in one account', async () => {
    const store = new MemStore({
      ...household(),
      subscription: [
        { id: 1, userId: 2, accountId: 2, shopId: 2, categoryId: null },
      ],
      shop: [lidl(1, null), lidl(2, 2, 2)],
    });
    const actions = await planMigration(store);
    const lists = { shop: await store.lists('shop'), category: [] };
    expect(plannedDuplicates(lists, actions)).toEqual([
      'shop "Lidl" in account 2: #2, copy of #1',
    ]);
  });
});
