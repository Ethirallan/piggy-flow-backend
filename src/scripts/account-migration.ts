/**
 * Data migration to account-owned shops and categories (spec §5, `migrate:accounts`).
 *
 * Safety model:
 * - No row is ever deleted. Duplicate Personal accounts are kept, renamed and
 *   marked non-personal once their rows have moved out.
 * - Every write is conditional on the value the plan saw; a write that matches
 *   no row is logged as skipped and the run continues.
 * - Each applied write appends one fsynced JSON line to the log, so a rollback
 *   can restore every row individually. The first line of a new log holds the
 *   per-user bill totals taken before any write.
 * - The run re-plans from the current data, so rerunning after an interruption
 *   only does what is left.
 *
 * Pure over an injected `AccountsStore`, so it can be tested without MySQL.
 */
import { mkdir, open, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

export type Table = 'shop' | 'category';
export type RefTable = 'bill' | 'subscription';
export type UserRow = { id: number };
/** One row per member of a Personal account. */
export type PersonalRow = { accountId: number; userId: number; name: string };
export type RefRow = {
  id: number;
  userId: number;
  accountId: number | null;
  shopId: number | null;
  categoryId: number | null;
  price?: number;
};
export type ListRow = {
  id: number;
  userId: number | null;
  accountId: number | null;
  name: string;
  emoji?: string | null;
};

export const DUPLICATE_PERSONAL_NAME = 'Personal (duplicate)';

export interface AccountsStore {
  users(): Promise<UserRow[]>;
  personalAccounts(): Promise<PersonalRow[]>;
  refs(table: RefTable): Promise<RefRow[]>;
  lists(table: Table): Promise<ListRow[]>;
  /** Creates a Personal account whose only member is the user; returns its id. */
  createPersonal(userId: number): Promise<number>;
  /**
   * Sets `personal = false` and renames the account to
   * `DUPLICATE_PERSONAL_NAME`, only while it is personal and named `expectedName`.
   */
  clearPersonal(accountId: number, expectedName: string): Promise<boolean>;
  setRefAccount(
    table: RefTable,
    id: number,
    expected: number | null,
    accountId: number,
  ): Promise<boolean>;
  setListAccount(
    table: Table,
    id: number,
    expected: number | null,
    accountId: number,
  ): Promise<boolean>;
  insertListCopy(
    table: Table,
    source: ListRow,
    accountId: number,
  ): Promise<number>;
  repoint(
    table: RefTable,
    id: number,
    field: 'shopId' | 'categoryId',
    expected: number,
    newId: number,
  ): Promise<boolean>;
}

/**
 * In a plan, a negative account id `-u` stands for the Personal account the
 * `personal` action creates for user `u`; the run resolves it to the real id.
 */
export type Action =
  | {
      kind: 'dedupe-move';
      table: RefTable | Table;
      id: number;
      from: number;
      to: number;
    }
  | {
      kind: 'dedupe-personal';
      userId: number;
      keep: number;
      extra: number;
      name: string;
    }
  | { kind: 'personal'; userId: number }
  | { kind: 'ref-account'; table: RefTable; id: number; from: null; to: number }
  | {
      kind: 'list-account';
      table: Table;
      id: number;
      from: number | null;
      to: number;
    }
  | {
      kind: 'copy';
      table: Table;
      sourceId: number;
      to: number;
      refs: { table: RefTable; id: number }[];
    }
  | {
      kind: 'repoint';
      table: RefTable;
      id: number;
      field: 'shopId' | 'categoryId';
      from: number;
      to: number;
    }
  | { kind: 'skip'; table: RefTable | Table; id: number; reason: string };

const REF_TABLES: RefTable[] = ['bill', 'subscription'];
const LIST_TABLES: Table[] = ['shop', 'category'];

type Rows = Record<RefTable, RefRow[]> & Record<Table, ListRow[]>;

async function load(store: AccountsStore): Promise<Rows> {
  const rows = {} as Rows;
  for (const t of [...REF_TABLES, ...LIST_TABLES]) {
    const list: { id: number }[] =
      t === 'bill' || t === 'subscription'
        ? await store.refs(t)
        : await store.lists(t);
    // Copies, so planning can simulate moves without touching the store's rows.
    rows[t] = list.map((r) => ({ ...r })).sort((a, b) => a.id - b.id) as any;
  }
  return rows;
}

/** Reads the data and returns the actions, in apply order. Writes nothing. */
export async function planMigration(store: AccountsStore): Promise<Action[]> {
  return (await plan(store)).actions;
}

async function plan(store: AccountsStore) {
  const rows = await load(store);
  const actions: Action[] = [];
  const personalOf = new Map<number, number>();

  // 0. Duplicate Personal accounts: the lowest id is kept. The user's rows move
  //    into it first; only then is the duplicate marked non-personal.
  const byUser = new Map<number, PersonalRow[]>();
  for (const p of await store.personalAccounts()) {
    const mine = byUser.get(p.userId) ?? [];
    if (!mine.some((m) => m.accountId === p.accountId)) mine.push(p);
    byUser.set(p.userId, mine);
  }
  const clears: Action[] = [];
  for (const [userId, mine] of [...byUser].sort((a, b) => a[0] - b[0])) {
    const [keep, ...extras] = mine.sort((a, b) => a.accountId - b.accountId);
    personalOf.set(userId, keep.accountId);
    for (const extra of extras) {
      for (const table of [...REF_TABLES, ...LIST_TABLES]) {
        for (const row of rows[table] as {
          id: number;
          userId: number | null;
          accountId: number | null;
        }[]) {
          if (row.userId !== userId || row.accountId !== extra.accountId)
            continue;
          actions.push({
            kind: 'dedupe-move',
            table,
            id: row.id,
            from: extra.accountId,
            to: keep.accountId,
          });
          row.accountId = keep.accountId;
        }
      }
      clears.push({
        kind: 'dedupe-personal',
        userId,
        keep: keep.accountId,
        extra: extra.accountId,
        name: extra.name,
      });
    }
  }
  actions.push(...clears);

  // 1. A Personal account for every user without one.
  for (const u of [...(await store.users())].sort((a, b) => a.id - b.id)) {
    if (personalOf.has(u.id)) continue;
    actions.push({ kind: 'personal', userId: u.id });
    personalOf.set(u.id, -u.id);
  }

  // 2. Bills and subscriptions without an account go to their creator's Personal.
  for (const table of REF_TABLES) {
    for (const r of rows[table]) {
      if (r.accountId != null) continue;
      const to = personalOf.get(r.userId);
      if (to === undefined) {
        actions.push({
          kind: 'skip',
          table,
          id: r.id,
          reason: `creator ${r.userId} is not a user`,
        });
        continue;
      }
      actions.push({ kind: 'ref-account', table, id: r.id, from: null, to });
      r.accountId = to;
    }
  }

  // 3. Each shop and category goes where its bills and subscriptions are.
  //    A row that receives repoints from another row stays where it is
  //    (pinned); planning repeats until the pinned set stops growing.
  const personal = new Set(personalOf.values());
  for (const table of LIST_TABLES) {
    let pinned = new Set<number>();
    for (;;) {
      const res = planLists(table, rows, personalOf, personal, pinned);
      if ([...res.pins].every((id) => pinned.has(id))) {
        actions.push(...res.actions);
        break;
      }
      pinned = new Set([...pinned, ...res.pins]);
    }
  }

  return { actions, rows };
}

const sameList = (a: ListRow, b: ListRow) =>
  a.userId === b.userId &&
  a.name.trim().toLowerCase() === b.name.trim().toLowerCase() &&
  (a.emoji ?? null) === (b.emoji ?? null);

function planLists(
  table: Table,
  rows: Rows,
  personalOf: Map<number, number>,
  personal: Set<number>,
  pinned: Set<number>,
) {
  const field = table === 'shop' ? 'shopId' : 'categoryId';
  const usedBy = new Map<
    number,
    { table: RefTable; id: number; accountId: number }[]
  >();
  for (const rt of REF_TABLES) {
    for (const r of rows[rt]) {
      if (r[field] == null || r.accountId == null) continue;
      const refs = usedBy.get(r[field]) ?? [];
      refs.push({ table: rt, id: r.id, accountId: r.accountId });
      usedBy.set(r[field], refs);
    }
  }

  const actions: Action[] = [];
  const pins = new Set<number>();
  for (const row of rows[table]) {
    const refs = usedBy.get(row.id) ?? [];
    const accounts = new Set(refs.map((r) => r.accountId));
    if (pinned.has(row.id)) accounts.add(row.accountId);
    if (accounts.size === 0) {
      const to = personalOf.get(row.userId);
      if (to === undefined) {
        const reason =
          row.userId == null
            ? 'no creator and no references'
            : `creator ${row.userId} is not a user`;
        actions.push({ kind: 'skip', table, id: row.id, reason });
      } else if (row.accountId !== to) {
        actions.push({
          kind: 'list-account',
          table,
          id: row.id,
          from: row.accountId,
          to,
        });
      }
      continue;
    }
    // Most bills (subscriptions don't count), then Personal, then lowest id.
    const bills = (acc: number) =>
      refs.filter((r) => r.table === 'bill' && r.accountId === acc).length;
    const isPersonal = (acc: number) => (personal.has(acc) ? 1 : 0);
    const winner = pinned.has(row.id)
      ? row.accountId
      : [...accounts].sort(
          (a, b) =>
            bills(b) - bills(a) || isPersonal(b) - isPersonal(a) || a - b,
        )[0];
    if (row.accountId !== winner) {
      actions.push({
        kind: 'list-account',
        table,
        id: row.id,
        from: row.accountId,
        to: winner,
      });
    }
    for (const acc of accounts) {
      if (acc === winner) continue;
      const moving = refs
        .filter((r) => r.accountId === acc)
        .map((r) => ({ table: r.table, id: r.id }));
      const existing = rows[table].find(
        (c) => c.id !== row.id && c.accountId === acc && sameList(c, row),
      );
      if (!existing) {
        actions.push({
          kind: 'copy',
          table,
          sourceId: row.id,
          to: acc,
          refs: moving,
        });
        continue;
      }
      pins.add(existing.id);
      for (const r of moving) {
        actions.push({
          kind: 'repoint',
          ...r,
          field,
          from: row.id,
          to: existing.id,
        });
      }
    }
  }
  return { actions, pins };
}

/** Bill count and price sum per user, the sum rounded to cents. */
export function totalsOf(
  bills: RefRow[],
): Record<string, { bills: number; sum: number }> {
  const perUser: Record<string, { bills: number; sum: number }> = {};
  for (const b of bills) {
    const t = (perUser[b.userId] ??= { bills: 0, sum: 0 });
    t.bills++;
    t.sum += Number(b.price ?? 0);
  }
  for (const t of Object.values(perUser)) t.sum = Math.round(t.sum * 100) / 100;
  return perUser;
}

/**
 * Plans, then applies the actions in order. Log lines: `totals` (first line of
 * a new log), one line per applied write (the action, with `newId` for created
 * rows and resolved account ids), and `skipped` lines carrying the action and a
 * reason. Throws if the store throws; rerunning picks up what is left.
 */
export async function runMigration(
  store: AccountsStore,
  logFile: string,
): Promise<{ applied: number; skipped: Action[] }> {
  const { actions, rows } = await plan(store);
  const isNew = await stat(logFile).then(
    (s) => s.size === 0,
    () => true,
  );
  const totals = isNew ? totalsOf(await store.refs('bill')) : null;

  await mkdir(dirname(logFile), { recursive: true });
  const log = await open(logFile, 'a');
  const write = async (entry: object) => {
    await log.write(JSON.stringify(entry) + '\n');
    await log.sync();
  };

  let applied = 0;
  const skipped: Action[] = [];
  const skip = async (action: Action, reason: string) => {
    skipped.push(action);
    await write({ kind: 'skipped', reason, action });
  };
  /** Applies one conditional write and logs `entry` or a skip. */
  const apply = async (action: Action, ok: boolean, entry: object = action) => {
    if (!ok) {
      await skip(action, 'conditional write matched no row');
      return false;
    }
    await write(entry);
    applied++;
    return true;
  };

  const created = new Map<number, number>();
  const extrasNotEmptied = new Set<number>();

  try {
    if (totals) await write({ kind: 'totals', perUser: totals });
    for (const planned of actions) {
      const a =
        'to' in planned && planned.kind !== 'repoint' && planned.to < 0
          ? { ...planned, to: created.get(planned.to) }
          : planned;
      if ('to' in a && a.to === undefined) {
        await skip(planned, 'the Personal account was not created');
        continue;
      }
      switch (a.kind) {
        case 'dedupe-move': {
          const ok =
            a.table === 'bill' || a.table === 'subscription'
              ? await store.setRefAccount(a.table, a.id, a.from, a.to)
              : await store.setListAccount(a.table, a.id, a.from, a.to);
          if (!(await apply(a, ok))) extrasNotEmptied.add(a.from);
          break;
        }
        case 'dedupe-personal':
          if (extrasNotEmptied.has(a.extra))
            await skip(a, 'a row could not be moved out of it');
          else await apply(a, await store.clearPersonal(a.extra, a.name));
          break;
        case 'personal': {
          const newId = await store.createPersonal(a.userId);
          created.set(-a.userId, newId);
          await apply(a, true, { ...a, newId });
          break;
        }
        case 'ref-account':
          await apply(a, await store.setRefAccount(a.table, a.id, null, a.to));
          break;
        case 'list-account':
          await apply(
            a,
            await store.setListAccount(a.table, a.id, a.from, a.to),
          );
          break;
        case 'copy': {
          const source = rows[a.table].find((r) => r.id === a.sourceId);
          const newId = await store.insertListCopy(a.table, source, a.to);
          await apply(a, true, { ...a, newId });
          // One log line per repoint, so a rollback can restore each one.
          const field = a.table === 'shop' ? 'shopId' : 'categoryId';
          for (const r of a.refs) {
            const ok = await store.repoint(
              r.table,
              r.id,
              field,
              a.sourceId,
              newId,
            );
            await apply(
              { kind: 'repoint', ...r, field, from: a.sourceId, to: newId },
              ok,
            );
          }
          break;
        }
        case 'repoint':
          await apply(
            a,
            await store.repoint(a.table, a.id, a.field, a.from, a.to),
          );
          break;
        case 'skip':
          await skip(a, a.reason);
          break;
      }
    }
  } finally {
    await log.close();
  }
  return { applied, skipped };
}
