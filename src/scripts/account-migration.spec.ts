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
  planMigration,
  runMigration,
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
  /** Return 'false' to make a conditional write match no row, 'throw' to fail it. */
  onWrite?: (method: string, id: number) => 'false' | 'throw' | void;

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

  private hook(method: string, id: number): boolean {
    const r = this.onWrite?.(method, id);
    if (r === 'throw') throw new Error(`${method} failed on ${id}`);
    return r !== 'false';
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
    if (
      !this.hook('clearPersonal', accountId) ||
      !a?.personal ||
      a.name !== expectedName
    )
      return false;
    a.personal = false;
    a.name = 'Personal (duplicate)';
    return true;
  }
  async setRefAccount(
    table: RefTable,
    id: number,
    expected: number | null,
    accountId: number,
  ) {
    const r = this.data[table].find((x) => x.id === id);
    if (!this.hook('setRefAccount', id) || !r || r.accountId !== expected)
      return false;
    r.accountId = accountId;
    return true;
  }
  async setListAccount(
    table: Table,
    id: number,
    expected: number | null,
    accountId: number,
  ) {
    const r = this.data[table].find((x) => x.id === id);
    if (!this.hook('setListAccount', id) || !r || r.accountId !== expected)
      return false;
    r.accountId = accountId;
    return true;
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
    if (!this.hook('repoint', id) || !r || r[field] !== expected) return false;
    r[field] = newId;
    return true;
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
      'personal',
      'personal',
      'ref-account',
      'ref-account',
      'ref-account',
    ]);
    expect(log[1]).toEqual({ kind: 'personal', userId: 1, newId: 1 });
    expect(log[3]).toEqual({
      kind: 'ref-account',
      table: 'bill',
      id: 1,
      from: null,
      to: 1,
    });

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
    expect((await readLog()).slice(1)).toEqual([
      { kind: 'personal', userId: 1, newId: 1 },
      {
        kind: 'skipped',
        reason: 'conditional write matched no row',
        action: skipped,
      },
      { kind: 'ref-account', table: 'bill', id: 2, from: null, to: 1 },
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
  });
});
