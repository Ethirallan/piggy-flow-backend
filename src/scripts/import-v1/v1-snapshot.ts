import type { DumpRow } from './parse-dump.js';

export interface V1User {
  id: number;
  email: string;
  displayName: string;
}
export interface V1Account {
  id: number;
  name: string;
  created: string;
  lastUpdate: string;
}
export interface V1Membership {
  userId: number;
  accountId: number;
}
export interface V1Shop {
  id: number;
  userId: number;
  name: string;
  created: string;
  lastUpdate: string;
}
export interface V1Category extends V1Shop {
  emoji: string | null;
}
export interface V1Bill {
  id: number;
  userId: number;
  accountId: number | null;
  shopId: number | null;
  categoryId: number | null;
  /** `YYYY-MM-DD HH:MM:SS`, no time zone (see dates.ts). */
  date: string;
  /** decimal(10,2) as text. */
  price: string;
  comment: string | null;
  /** UTC, `YYYY-MM-DD HH:MM:SS.ffffff`. */
  created: string;
  lastUpdate: string;
}
export interface V1Photo {
  id: number;
  billId: number;
  name: string;
  path: string;
  created: string;
}
export interface V1Subscription {
  id: number;
  userId: number;
  accountId: number | null;
  shopId: number | null;
  categoryId: number | null;
  chargeDay: number;
  price: string;
  name: string | null;
  created: string;
  lastUpdate: string;
}
export interface V1Snapshot {
  users: V1User[];
  accounts: V1Account[];
  memberships: V1Membership[];
  shops: V1Shop[];
  categories: V1Category[];
  bills: V1Bill[];
  photos: V1Photo[];
  subscriptions: V1Subscription[];
}

export class SnapshotError extends Error {
  constructor(readonly problems: string[]) {
    super(`The v1 dump has problems:\n- ${problems.join('\n- ')}`);
  }
}

const TABLES = [
  'user',
  'account',
  'user_accounts_account',
  'shop',
  'category',
  'bill',
  'bill_photo',
  'subscription',
] as const;

/** Typed v1 rows; throws SnapshotError listing every missing table / column and dangling reference. */
export function toSnapshot(tables: Map<string, DumpRow[]>): V1Snapshot {
  const problems: string[] = [];
  for (const table of TABLES) {
    if (!tables.has(table)) {
      problems.push(`table ${table} is missing`);
    }
  }
  const rows = (table: (typeof TABLES)[number]) => tables.get(table) ?? [];
  const missingColumns = new Set<string>();
  const reader = (table: string, row: DumpRow) => {
    const label = `${table} ${row.id ?? `(${row.userId ?? '?'}, ${row.accountId ?? '?'})`}`;
    const raw = (column: string): string | null => {
      if (!(column in row)) {
        if (!missingColumns.has(`${table}.${column}`)) {
          missingColumns.add(`${table}.${column}`);
          problems.push(`${label}: column ${column} is missing`);
        }
        return null;
      }
      return row[column];
    };
    const text = (column: string) => {
      const value = raw(column);
      if (value === null && column in row) {
        problems.push(`${label}: ${column} is NULL`);
      }
      return value ?? '';
    };
    const optionalText = (column: string) => raw(column);
    const integer = (column: string, value: string) => {
      const number = Number(value);
      if (value.trim() === '' || !Number.isSafeInteger(number)) {
        problems.push(`${label}: ${column} "${value}" is not an integer`);
      }
      return number;
    };
    // A required id column that is NULL in the dump becomes 0, which never
    // exists, so it is reported as a dangling reference
    // (e.g. `bill 5: user 0 does not exist`).
    const id = (column: string) => {
      const value = raw(column);
      return value === null ? 0 : integer(column, value);
    };
    const optionalId = (column: string) => {
      const value = raw(column);
      return value === null ? null : integer(column, value);
    };
    return { text, optionalText, id, optionalId };
  };

  const snapshot: V1Snapshot = {
    users: rows('user').map((row) => {
      const r = reader('user', row);
      return {
        id: r.id('id'),
        email: r.text('email'),
        displayName: r.text('displayName'),
      };
    }),
    accounts: rows('account').map((row) => {
      const r = reader('account', row);
      return {
        id: r.id('id'),
        name: r.text('name'),
        created: r.text('created'),
        lastUpdate: r.text('lastUpdate'),
      };
    }),
    memberships: rows('user_accounts_account').map((row) => {
      const r = reader('user_accounts_account', row);
      return { userId: r.id('userId'), accountId: r.id('accountId') };
    }),
    shops: rows('shop').map((row) => {
      const r = reader('shop', row);
      return {
        id: r.id('id'),
        userId: r.id('userId'),
        name: r.text('name'),
        created: r.text('created'),
        lastUpdate: r.text('lastUpdate'),
      };
    }),
    categories: rows('category').map((row) => {
      const r = reader('category', row);
      return {
        id: r.id('id'),
        userId: r.id('userId'),
        name: r.text('name'),
        emoji: r.optionalText('emoji'),
        created: r.text('created'),
        lastUpdate: r.text('lastUpdate'),
      };
    }),
    bills: rows('bill').map((row) => {
      const r = reader('bill', row);
      return {
        id: r.id('id'),
        userId: r.id('userId'),
        accountId: r.optionalId('accountId'),
        shopId: r.optionalId('shopId'),
        categoryId: r.optionalId('categoryId'),
        date: r.text('date'),
        price: r.text('price'),
        comment: r.optionalText('comment'),
        created: r.text('created'),
        lastUpdate: r.text('lastUpdate'),
      };
    }),
    photos: rows('bill_photo').map((row) => {
      const r = reader('bill_photo', row);
      return {
        id: r.id('id'),
        billId: r.id('billId'),
        name: r.text('name'),
        path: r.text('path'),
        created: r.text('created'),
      };
    }),
    subscriptions: rows('subscription').map((row) => {
      const r = reader('subscription', row);
      return {
        id: r.id('id'),
        userId: r.id('userId'),
        accountId: r.optionalId('accountId'),
        shopId: r.optionalId('shopId'),
        categoryId: r.optionalId('categoryId'),
        chargeDay: r.id('chargeDay'),
        price: r.text('price'),
        name: r.optionalText('name'),
        created: r.text('created'),
        lastUpdate: r.text('lastUpdate'),
      };
    }),
  };

  const duplicates = (table: string, list: { id: number }[]) => {
    const seen = new Set<number>();
    for (const { id } of list) {
      if (seen.has(id)) {
        problems.push(`${table} ${id}: duplicate id`);
      }
      seen.add(id);
    }
  };
  duplicates('user', snapshot.users);
  duplicates('account', snapshot.accounts);
  duplicates('shop', snapshot.shops);
  duplicates('category', snapshot.categories);
  duplicates('bill', snapshot.bills);
  duplicates('bill_photo', snapshot.photos);
  duplicates('subscription', snapshot.subscriptions);

  const ids = (list: { id: number }[]) => new Set(list.map((row) => row.id));
  const users = ids(snapshot.users);
  const accounts = ids(snapshot.accounts);
  const shops = ids(snapshot.shops);
  const categories = ids(snapshot.categories);
  const bills = ids(snapshot.bills);
  const check = (
    label: string,
    kind: string,
    id: number | null,
    known: Set<number>,
  ) => {
    if (id !== null && !known.has(id)) {
      problems.push(`${label}: ${kind} ${id} does not exist`);
    }
  };
  for (const m of snapshot.memberships) {
    const label = `membership (${m.userId}, ${m.accountId})`;
    check(label, 'user', m.userId, users);
    check(label, 'account', m.accountId, accounts);
  }
  for (const s of snapshot.shops)
    check(`shop ${s.id}`, 'user', s.userId, users);
  for (const c of snapshot.categories)
    check(`category ${c.id}`, 'user', c.userId, users);
  for (const row of [
    ...snapshot.bills.map((b) => ['bill', b] as const),
    ...snapshot.subscriptions.map((s) => ['subscription', s] as const),
  ]) {
    const [kind, item] = row;
    const label = `${kind} ${item.id}`;
    check(label, 'user', item.userId, users);
    check(label, 'account', item.accountId, accounts);
    check(label, 'shop', item.shopId, shops);
    check(label, 'category', item.categoryId, categories);
  }
  for (const p of snapshot.photos)
    check(`photo ${p.id}`, 'bill', p.billId, bills);

  if (problems.length > 0) {
    throw new SnapshotError(problems);
  }
  return snapshot;
}
