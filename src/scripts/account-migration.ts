/**
 * Data migration to account-owned shops and categories (spec §5, `migrate:accounts`).
 *
 * Safety model:
 * - No row is ever deleted. Duplicate Personal accounts are kept, renamed and
 *   marked non-personal once their rows have moved out.
 * - Every write is conditional on the value the plan saw; a write that matches
 *   no row is logged as skipped and the run continues.
 * - Every log line is appended and fsynced before the run goes on, so a crash
 *   never hides a write from the rollback (see "Log lines" below).
 * - The run re-plans from the current data, so rerunning after an interruption
 *   only does what is left.
 *
 * Log lines (JSONL, one object per line; `verify` and `rollback` read them):
 * - `{ kind: 'totals', perUser: { [userId]: { bills, sum } } }`: first line of
 *   a new log, read before any write (`totalsOf`).
 * - `{ kind: 'intent', action }`: written and fsynced BEFORE each conditional
 *   write. `action` carries the expected old value (`from`, or `name` for
 *   `dedupe-personal`) and the new value (`to`), with real account ids. The
 *   write may or may not have happened; a rollback treats an intent as a
 *   candidate and restores only where the current value equals the new value.
 * - `{ kind: 'applied', action }`: the write took effect. For the inserts
 *   (`personal`, `copy`) it is written right after the insert returns and
 *   carries `newId`; inserts have no intent line. A `copy` is followed by an
 *   intent and an outcome line for each of its repoints (`kind: 'repoint'`).
 * - `{ kind: 'skipped', reason, action }`: the conditional write matched no
 *   row, or the action could not run (planned `skip`, unresolved Personal).
 * `applied` in the result counts the `applied` lines.
 *
 * Pure over an injected `AccountsStore`, so it can be tested without MySQL.
 */
import { mkdir, open, readFile, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

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
  /** Undoes `clearPersonal`, only while the account is a non-personal duplicate. */
  restorePersonal(accountId: number, name: string): Promise<boolean>;
  setRefAccount(
    table: RefTable,
    id: number,
    expected: number | null,
    accountId: number | null,
  ): Promise<boolean>;
  setListAccount(
    table: Table,
    id: number,
    expected: number | null,
    accountId: number | null,
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
  | {
      kind: 'skip';
      table: RefTable | Table | 'account';
      id: number;
      reason: string;
    };

const REF_TABLES: RefTable[] = ['bill', 'subscription'];
const LIST_TABLES: Table[] = ['shop', 'category'];

type Rows = Record<RefTable, RefRow[]> & Record<Table, ListRow[]>;

// Copies, so planning can simulate moves without touching the store's rows.
const sortedCopy = <T extends { id: number }>(list: T[]): T[] =>
  list.map((r) => ({ ...r })).sort((a, b) => a.id - b.id);

async function load(store: AccountsStore): Promise<Rows> {
  return {
    bill: sortedCopy(await store.refs('bill')),
    subscription: sortedCopy(await store.refs('subscription')),
    shop: sortedCopy(await store.lists('shop')),
    category: sortedCopy(await store.lists('category')),
  };
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
  //    into it first; only then is the duplicate marked non-personal. A
  //    Personal account with several members is left alone and never used as
  //    anyone's Personal.
  const byUser = new Map<number, PersonalRow[]>();
  const members = new Map<number, Set<number>>();
  for (const p of await store.personalAccounts()) {
    const mine = byUser.get(p.userId) ?? [];
    if (!mine.some((m) => m.accountId === p.accountId)) mine.push(p);
    byUser.set(p.userId, mine);
    members.set(
      p.accountId,
      (members.get(p.accountId) ?? new Set()).add(p.userId),
    );
  }
  const clears: Action[] = [];
  for (const [accountId, users] of [...members].sort((a, b) => a[0] - b[0])) {
    if (users.size < 2) continue;
    const ids = [...users].sort((a, b) => a - b).join(', ');
    const reason = `Personal account shared by users ${ids}; left unchanged`;
    clears.push({ kind: 'skip', table: 'account', id: accountId, reason });
  }
  for (const [userId, all] of [...byUser].sort((a, b) => a[0] - b[0])) {
    const mine = all.filter((p) => members.get(p.accountId).size === 1);
    if (mine.length === 0) continue;
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
    // Most bills (subscriptions don't count), then Personal, then the row's
    // current account (so a rerun keeps the same winner), then lowest id. A
    // Personal still to be created (-u) sorts after every real id, by u, as it
    // will get a higher id than any existing account.
    const bills = (acc: number) =>
      refs.filter((r) => r.table === 'bill' && r.accountId === acc).length;
    const flag = (yes: boolean) => (yes ? 1 : 0);
    const idOrder = (acc: number) => (acc < 0 ? [1, -acc] : [0, acc]);
    const winner = pinned.has(row.id)
      ? row.accountId
      : [...accounts].sort((a, b) => {
          const [ia, ib] = [idOrder(a), idOrder(b)];
          return (
            bills(b) - bills(a) ||
            flag(personal.has(b)) - flag(personal.has(a)) ||
            flag(b === row.accountId) - flag(a === row.accountId) ||
            ia[0] - ib[0] ||
            ia[1] - ib[1]
          );
        })[0];
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

type Totals = Record<string, { bills: number; sum: number }>;

/** Bill count and price sum per user, the sum rounded to cents. */
export function totalsOf(bills: RefRow[]): Totals {
  const perUser: Totals = {};
  for (const b of bills) {
    const t = (perUser[b.userId] ??= { bills: 0, sum: 0 });
    t.bills++;
    t.sum += Number(b.price ?? 0);
  }
  for (const t of Object.values(perUser)) t.sum = Math.round(t.sum * 100) / 100;
  return perUser;
}

/**
 * Plans, then applies the actions in order, logging as described at the top
 * of the file. Throws if the store throws; rerunning picks up what is left.
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
  const done = async (action: object) => {
    await write({ kind: 'applied', action });
    applied++;
  };
  /** Logs the intent, runs the conditional write, then logs the outcome. */
  const conditional = async (action: Action, run: () => Promise<boolean>) => {
    await write({ kind: 'intent', action });
    const ok = await run();
    if (ok) await done(action);
    else await skip(action, 'conditional write matched no row');
    return ok;
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
          const ok = await conditional(a, () =>
            a.table === 'bill' || a.table === 'subscription'
              ? store.setRefAccount(a.table, a.id, a.from, a.to)
              : store.setListAccount(a.table, a.id, a.from, a.to),
          );
          if (!ok) extrasNotEmptied.add(a.from);
          break;
        }
        case 'dedupe-personal':
          if (extrasNotEmptied.has(a.extra))
            await skip(a, 'a row could not be moved out of it');
          else await conditional(a, () => store.clearPersonal(a.extra, a.name));
          break;
        case 'personal': {
          const newId = await store.createPersonal(a.userId);
          created.set(-a.userId, newId);
          await done({ ...a, newId });
          break;
        }
        case 'ref-account':
          await conditional(a, () =>
            store.setRefAccount(a.table, a.id, null, a.to),
          );
          break;
        case 'list-account':
          await conditional(a, () =>
            store.setListAccount(a.table, a.id, a.from, a.to),
          );
          break;
        case 'copy': {
          const source = rows[a.table].find((r) => r.id === a.sourceId);
          if (!source) throw new Error(`${a.table} ${a.sourceId} not found`);
          const newId = await store.insertListCopy(a.table, source, a.to);
          await done({ ...a, newId });
          // One intent and outcome per repoint, so a rollback can restore each.
          const field = a.table === 'shop' ? 'shopId' : 'categoryId';
          for (const r of a.refs) {
            const repoint: Action = {
              kind: 'repoint',
              ...r,
              field,
              from: a.sourceId,
              to: newId,
            };
            await conditional(repoint, () =>
              store.repoint(r.table, r.id, field, a.sourceId, newId),
            );
          }
          break;
        }
        case 'repoint':
          await conditional(a, () =>
            store.repoint(a.table, a.id, a.field, a.from, a.to),
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

type LogLine = { kind: string; perUser?: Totals; action?: Action };

/** Log files oldest first, by file name (`accounts-<timestamp>.jsonl`). */
const oldestFirst = (files: string[]) =>
  [...files].sort((a, b) => (basename(a) < basename(b) ? -1 : 1));

/** Parses a log; a torn last line (crash mid-write) is ignored. */
async function readLog(file: string): Promise<LogLine[]> {
  const lines = (await readFile(file, 'utf8')).split('\n').filter((l) => l);
  return lines.flatMap((line, i) => {
    try {
      return [JSON.parse(line) as LogLine];
    } catch (e) {
      if (i === lines.length - 1) return [];
      throw new Error(`${file} line ${i + 1}: ${(e as Error).message}`);
    }
  });
}

/**
 * Checks the migrated data: every row has an account, bills and subscriptions
 * use shops and categories from their own account, every user has exactly one
 * Personal account, and per-user bill totals equal the earliest `totals` line.
 */
export async function verify(
  store: AccountsStore,
  logFiles: string[],
): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];
  const rows = await load(store);
  for (const table of [...REF_TABLES, ...LIST_TABLES]) {
    for (const r of rows[table]) {
      if (r.accountId == null) problems.push(`${table} ${r.id} has no account`);
    }
  }
  const accountOf = {
    shop: new Map(rows.shop.map((r) => [r.id, r.accountId])),
    category: new Map(rows.category.map((r) => [r.id, r.accountId])),
  };
  for (const table of REF_TABLES) {
    for (const r of rows[table]) {
      for (const list of LIST_TABLES) {
        const id = list === 'shop' ? r.shopId : r.categoryId;
        const acc = accountOf[list].get(id);
        if (id == null || r.accountId == null || acc === r.accountId) continue;
        problems.push(
          `${table} ${r.id} is in account ${r.accountId} but its ${list} ${id} is in account ${acc}`,
        );
      }
    }
  }

  const personals = new Map<number, Set<number>>();
  for (const p of await store.personalAccounts()) {
    personals.set(
      p.userId,
      (personals.get(p.userId) ?? new Set()).add(p.accountId),
    );
  }
  for (const u of [...(await store.users())].sort((a, b) => a.id - b.id)) {
    const ids = [...(personals.get(u.id) ?? [])].sort((a, b) => a - b);
    if (ids.length === 1) continue;
    const list = ids.length ? ` (${ids.join(', ')})` : '';
    problems.push(`user ${u.id} has ${ids.length} Personal accounts${list}`);
  }

  let before: Totals | undefined;
  for (const file of oldestFirst(logFiles)) {
    before = (await readLog(file)).find((l) => l.kind === 'totals')?.perUser;
    if (before) break;
  }
  if (!before) {
    problems.push(
      'no totals line in the logs, so bill totals were not compared',
    );
  } else {
    const now = totalsOf(rows.bill);
    const none = { bills: 0, sum: 0 };
    for (const user of new Set([...Object.keys(before), ...Object.keys(now)])) {
      const [b, n] = [before[user] ?? none, now[user] ?? none];
      if (b.bills === n.bills && b.sum === n.sum) continue;
      problems.push(
        `user ${user}: ${b.bills} bills totalling ${b.sum} at the first run, now ${n.bills} totalling ${n.sum}`,
      );
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Undoes every `intent` in the logs, newest file first and each file from the
 * end. An intent is restored only where the current value still equals its
 * new value, so rows changed since (or writes that never happened) are
 * skipped. Created Personal accounts and copies are kept.
 */
export async function rollback(
  store: AccountsStore,
  logFiles: string[],
): Promise<{ restored: number; skipped: number; skippedIntents: Action[] }> {
  let restored = 0;
  const skippedIntents: Action[] = [];
  for (const file of oldestFirst(logFiles).reverse()) {
    for (const line of (await readLog(file)).reverse()) {
      if (line.kind !== 'intent') continue;
      if (await undo(store, line.action)) restored++;
      else skippedIntents.push(line.action);
    }
  }
  return { restored, skipped: skippedIntents.length, skippedIntents };
}

/** The row and column an intent's undo checks, and the value it expects there. */
export function undoTarget(a: Action): {
  table: RefTable | Table | 'account';
  id: number;
  column: string;
  expected: number | string;
} {
  switch (a.kind) {
    case 'dedupe-personal':
      return {
        table: 'account',
        id: a.extra,
        column: 'name',
        expected: DUPLICATE_PERSONAL_NAME,
      };
    case 'repoint':
      return { table: a.table, id: a.id, column: a.field, expected: a.to };
    case 'dedupe-move':
    case 'ref-account':
    case 'list-account':
      return { table: a.table, id: a.id, column: 'accountId', expected: a.to };
    default:
      throw new Error(`Unexpected intent: ${a.kind}`);
  }
}

function undo(store: AccountsStore, a: Action): Promise<boolean> {
  switch (a.kind) {
    case 'dedupe-move':
      return a.table === 'bill' || a.table === 'subscription'
        ? store.setRefAccount(a.table, a.id, a.to, a.from)
        : store.setListAccount(a.table, a.id, a.to, a.from);
    case 'dedupe-personal':
      return store.restorePersonal(a.extra, a.name);
    case 'ref-account':
      return store.setRefAccount(a.table, a.id, a.to, null);
    case 'list-account':
      return store.setListAccount(a.table, a.id, a.to, a.from);
    case 'repoint':
      return store.repoint(a.table, a.id, a.field, a.to, a.from);
    default:
      throw new Error(`Unexpected intent: ${a.kind}`);
  }
}

/** An account id for people; a placeholder `-u` is user u's new Personal. */
export const accountLabel = (id: number) =>
  id < 0 ? `the new Personal of user ${-id}` : `account ${id}`;

/**
 * Same-name shops and categories (trimmed, case-insensitive) that end up in
 * one account after the plan, where the plan moved or copied at least one.
 * `lists` is the data the plan was made from.
 */
export function plannedDuplicates(
  lists: Record<Table, ListRow[]>,
  actions: Action[],
): string[] {
  const out: string[] = [];
  for (const table of LIST_TABLES) {
    type Entry = {
      label: string;
      name: string;
      accountId: number | null;
      changed: boolean;
    };
    const entries: Entry[] = lists[table].map((r) => ({
      label: `#${r.id}`,
      name: r.name,
      accountId: r.accountId,
      changed: false,
    }));
    const byId = new Map(lists[table].map((r, i) => [r.id, entries[i]]));
    for (const a of actions) {
      if (!('table' in a) || a.table !== table) continue;
      if (a.kind === 'list-account' || a.kind === 'dedupe-move') {
        Object.assign(byId.get(a.id), { accountId: a.to, changed: true });
      } else if (a.kind === 'copy') {
        const name = byId.get(a.sourceId).name;
        entries.push({
          label: `copy of #${a.sourceId}`,
          name,
          accountId: a.to,
          changed: true,
        });
      }
    }
    const groups = new Map<string, Entry[]>();
    for (const e of entries) {
      if (e.accountId == null) continue;
      const key = `${e.accountId}|${e.name.trim().toLowerCase()}`;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    for (const g of groups.values()) {
      if (g.length < 2 || !g.some((e) => e.changed)) continue;
      const acc = g[0].accountId;
      const where = accountLabel(acc);
      out.push(
        `${table} "${g[0].name}" in ${where}: ${g
          .map((e) => e.label)
          .join(', ')}`,
      );
    }
  }
  return out;
}
