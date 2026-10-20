import { randomUUID } from 'node:crypto';
import { normalizeComment } from '../../bills/bills.service.js';
import { photoDisplayName } from '../../photos/photo-name.js';
import {
  initialLastChargedMonth,
  localToday,
  monthOf,
} from '../../subscriptions/charge-schedule.js';
import { normalizeName } from '../../subscriptions/subscriptions.service.js';
import { normalizeEmail } from '../../users/normalize-email.js';
import {
  cutCodePoints,
  readBillDate,
  toCents,
  wallTimeToInstant,
  type DateRule,
} from './dates.js';
import { planLists, type ListUse } from './plan-lists.js';
import type { V1Bill, V1Snapshot } from './v1-snapshot.js';

const NAME_MAX = 100;
const COMMENT_MAX = 1000;

/** A user who registered in v2, with their Personal account. */
export interface V2User {
  id: string;
  email: string;
  personalAccountId: string;
}

export interface PlanOptions {
  /** Emails of v1 users whose data is left out. */
  dismissedEmails: string[];
  /** The import day in Ljubljana (YYYY-MM-DD), for subscriptions without a charge. */
  today: string;
  newId?: () => string;
}

export interface NewAccount {
  id: string;
  name: string;
  isPersonal: false;
  createdAt: Date;
  updatedAt: Date;
}
export interface NewMember {
  accountId: string;
  userId: string;
  joinedAt: Date;
}
export interface NewShop {
  id: string;
  accountId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface NewCategory extends NewShop {
  emoji: string | null;
}
export interface NewSubscription {
  id: string;
  accountId: string;
  name: string | null;
  priceCents: number;
  chargeDay: number;
  shopId: string | null;
  categoryId: string | null;
  lastChargedMonth: string;
  createdById: string;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface NewBill {
  id: string;
  accountId: string;
  date: Date;
  priceCents: number;
  shopId: string | null;
  categoryId: string | null;
  comment: string | null;
  subscriptionId: string | null;
  createdById: string;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
}
/** Width, height and size are filled in when the photo is converted. */
export interface NewPhoto {
  id: string;
  billId: string;
  name: string;
  source: string;
  createdById: string;
  createdAt: Date;
}

export interface PlanReport {
  users: { v1Email: string; v2UserId: string }[];
  leftOut: {
    users: string[];
    accounts: string[];
    bills: number;
    subscriptions: number;
    photos: number;
  };
  dateRules: Record<DateRule, number>;
  borderline: {
    billId: number;
    date: string;
    asUtc: string;
    asLocal: string;
  }[];
  subscriptions: {
    name: string | null;
    accountId: string;
    matches: number;
    latest: string | null;
    lastChargedMonth: string;
  }[];
  /** v1 rows that make up each merged shop / category (filled by plan-lists). */
  merged: {
    kind: 'shop' | 'category';
    accountId: string;
    name: string;
    v1Ids: number[];
  }[];
  fixUps: string[];
}

export interface Plan {
  accounts: NewAccount[];
  members: NewMember[];
  shops: NewShop[];
  categories: NewCategory[];
  subscriptions: NewSubscription[];
  bills: NewBill[];
  photos: NewPhoto[];
  /**
   * Bill count and price sum per v2 account and per v2 user, counted from the
   * v1 bills directly (not from `bills`), so the import can check what it wrote.
   */
  v1Totals: V1Totals;
  report: PlanReport;
}

export interface Totals {
  bills: number;
  cents: number;
}
export interface V1Totals {
  perAccount: ({ accountId: string } & Totals)[];
  perUser: ({ userId: string } & Totals)[];
}

export class PlanError extends Error {
  constructor(readonly problems: string[]) {
    super(`The import can't run:\n- ${problems.join('\n- ')}`);
  }
}

const PLAIN_FILE = /^[^/\\]+$/;
const utc = (wall: string) => wallTimeToInstant(wall, 'utc');

/** The v2 rows for a v1 snapshot. Pure; throws PlanError listing everything that blocks the import. */
export function planImport(
  snapshot: V1Snapshot,
  v2Users: V2User[],
  options: PlanOptions,
): Plan {
  const newId = options.newId ?? randomUUID;
  const problems: string[] = [];
  const report: PlanReport = {
    users: [],
    leftOut: { users: [], accounts: [], bills: 0, subscriptions: 0, photos: 0 },
    dateRules: {
      'same-as-created': 0,
      'local-entry': 0,
      'mobile-era': 0,
      'web-era': 0,
    },
    borderline: [],
    subscriptions: [],
    merged: [],
    fixUps: [],
  };

  // Users.
  const v1Emails = new Set(snapshot.users.map((u) => normalizeEmail(u.email)));
  const dismissed = new Set(options.dismissedEmails.map(normalizeEmail));
  for (const email of dismissed) {
    if (!v1Emails.has(email)) problems.push(`${email} is not a v1 user`);
  }
  const v2ByEmail = new Map(v2Users.map((u) => [normalizeEmail(u.email), u]));
  const kept = new Map<number, V2User>();
  for (const user of snapshot.users) {
    const email = normalizeEmail(user.email);
    if (dismissed.has(email)) {
      report.leftOut.users.push(email);
      continue;
    }
    const v2 = v2ByEmail.get(email);
    if (!v2) {
      problems.push(
        `${email} has no v2 account (register, or pass it to --dismiss-users)`,
      );
      continue;
    }
    kept.set(user.id, v2);
    report.users.push({ v1Email: email, v2UserId: v2.id });
  }

  // Accounts.
  const accounts: NewAccount[] = [];
  const members: NewMember[] = [];
  const accountIds = new Map<number, string>();
  for (const account of snapshot.accounts) {
    const memberIds = snapshot.memberships.filter(
      (m) => m.accountId === account.id && kept.has(m.userId),
    );
    if (memberIds.length === 0) {
      report.leftOut.accounts.push(account.name);
      continue;
    }
    const name = account.name.trim();
    if (!name) {
      // Still planned (the import stops anyway), so its bills and photos are checked too.
      problems.push(`account ${account.id}: blank name`);
    }
    const id = newId();
    accountIds.set(account.id, id);
    accounts.push({
      id,
      name: cutName(name, `account ${account.id}`, report),
      isPersonal: false,
      createdAt: utc(account.created),
      updatedAt: utc(account.lastUpdate),
    });
    for (const m of memberIds) {
      members.push({
        accountId: id,
        userId: kept.get(m.userId)!.id,
        joinedAt: utc(account.created),
      });
    }
  }
  /** The v2 account of a kept user's bill / subscription. */
  const targetAccount = (
    label: string,
    userId: number,
    accountId: number | null,
  ): string | null => {
    if (accountId === null) return kept.get(userId)!.personalAccountId;
    const id = accountIds.get(accountId);
    if (!id)
      problems.push(`${label}: account ${accountId} has no imported member`);
    return id ?? null;
  };

  // Subscriptions (before bills: bills link to them), in v1 id order.
  const keptSubscriptions = [...snapshot.subscriptions]
    .sort((a, b) => a.id - b.id)
    .filter((s) => {
      if (kept.has(s.userId)) return true;
      report.leftOut.subscriptions++;
      return false;
    });
  const subscriptionPlans: {
    v1: (typeof keptSubscriptions)[number];
    row: NewSubscription;
    matches: V1Bill[];
  }[] = [];
  for (const s of keptSubscriptions) {
    const label = `subscription ${s.id}`;
    if (!Number.isInteger(s.chargeDay) || s.chargeDay < 1 || s.chargeDay > 31) {
      problems.push(`${label}: charge day ${s.chargeDay} is not 1–31`);
      continue;
    }
    const priceCents = toCents(s.price);
    if (priceCents <= 0) {
      report.fixUps.push(`${label}: price ${s.price}, skipped`);
      continue;
    }
    const accountId = targetAccount(label, s.userId, s.accountId);
    if (!accountId) continue;
    const user = kept.get(s.userId)!;
    const name = normalizeName(s.name);
    subscriptionPlans.push({
      v1: s,
      matches: [],
      row: {
        id: newId(),
        accountId,
        name: name === null ? null : cutName(name, label, report),
        priceCents,
        chargeDay: s.chargeDay,
        shopId: null,
        categoryId: null,
        lastChargedMonth: '',
        createdById: user.id,
        updatedById: user.id,
        createdAt: utc(s.created),
        updatedAt: utc(s.lastUpdate),
      },
    });
  }

  // Bills.
  const bills: NewBill[] = [];
  const billIds = new Map<number, string>();
  const billUses: ListUse[] = [];
  const v1OfBill = new Map<string, V1Bill>();
  for (const b of snapshot.bills) {
    const label = `bill ${b.id}`;
    if (!kept.has(b.userId)) {
      report.leftOut.bills++;
      continue;
    }
    const priceCents = toCents(b.price);
    if (priceCents === 0) {
      report.fixUps.push(`${label}: price 0, skipped`);
      continue;
    }
    const accountId = targetAccount(label, b.userId, b.accountId);
    if (!accountId) continue;
    const read = readBillDate(b.date, b.created);
    report.dateRules[read.rule]++;
    if (read.rule === 'web-era' && read.daysDiffer) {
      report.borderline.push({
        billId: b.id,
        date: b.date,
        asUtc: localToday(wallTimeToInstant(b.date, 'utc')),
        asLocal: localToday(wallTimeToInstant(b.date, 'local')),
      });
    }
    let comment = normalizeComment(b.comment);
    if (comment !== null && Array.from(comment).length > COMMENT_MAX) {
      comment = cutCodePoints(comment, COMMENT_MAX);
      report.fixUps.push(`${label}: comment cut to ${COMMENT_MAX} characters`);
    }
    // subscriptionPlans is sorted by v1 id, so the first candidate has the lowest.
    const candidates =
      b.comment === null
        ? []
        : subscriptionPlans.filter(
            (s) =>
              s.v1.userId === b.userId &&
              s.v1.accountId === b.accountId &&
              s.v1.name === b.comment,
          );
    const charge = candidates.at(0);
    if (candidates.length > 1) {
      report.fixUps.push(
        `${label}: matches ${candidates.length} subscriptions, linked to v1 subscription ${charge!.v1.id}`,
      );
    }
    charge?.matches.push(b);
    const user = kept.get(b.userId)!;
    const id = newId();
    billIds.set(b.id, id);
    const row: NewBill = {
      id,
      accountId,
      date: read.instant,
      priceCents,
      shopId: null,
      categoryId: null,
      comment,
      subscriptionId: charge?.row.id ?? null,
      createdById: user.id,
      updatedById: user.id,
      createdAt: utc(b.created),
      updatedAt: utc(b.lastUpdate),
    };
    bills.push(row);
    v1OfBill.set(id, b);
    billUses.push({ accountId, shopId: b.shopId, categoryId: b.categoryId });
  }

  // Subscriptions: charge month from the latest matched bill.
  for (const s of subscriptionPlans) {
    const latest = s.matches
      .map((b) => bills.find((row) => row.id === billIds.get(b.id))!.date)
      .reduce<Date | null>(
        (max, d) => (max === null || d > max ? d : max),
        null,
      );
    s.row.lastChargedMonth = latest
      ? monthOf(localToday(latest))
      : initialLastChargedMonth(s.v1.chargeDay, options.today);
    report.subscriptions.push({
      name: s.row.name,
      accountId: s.row.accountId,
      matches: s.matches.length,
      latest: latest?.toISOString() ?? null,
      lastChargedMonth: s.row.lastChargedMonth,
    });
  }

  // Photos.
  const photos: NewPhoto[] = [];
  for (const p of snapshot.photos) {
    const billId = billIds.get(p.billId);
    if (!billId) {
      report.leftOut.photos++;
      continue;
    }
    if (!PLAIN_FILE.test(p.path) || p.path === '.' || p.path === '..') {
      problems.push(`photo ${p.id}: path "${p.path}" is not a plain file name`);
      continue;
    }
    const v1 = v1OfBill.get(billId)!;
    photos.push({
      id: newId(),
      billId,
      name: photoDisplayName(p.name),
      source: p.path,
      createdById: kept.get(v1.userId)!.id,
      createdAt: utc(p.created),
    });
  }

  // Shops and categories.
  const subscriptionUses: ListUse[] = subscriptionPlans.map((s) => ({
    accountId: s.row.accountId,
    shopId: s.v1.shopId,
    categoryId: s.v1.categoryId,
  }));
  const lists = planLists(
    snapshot,
    [...billUses, ...subscriptionUses],
    (userId) => kept.get(userId)?.personalAccountId ?? null,
    newId,
    report,
    problems,
  );
  bills.forEach((row, i) => {
    row.shopId = lists.shopFor(row.accountId, billUses[i].shopId);
    row.categoryId = lists.categoryFor(row.accountId, billUses[i].categoryId);
  });
  subscriptionPlans.forEach((s) => {
    s.row.shopId = lists.shopFor(s.row.accountId, s.v1.shopId);
    s.row.categoryId = lists.categoryFor(s.row.accountId, s.v1.categoryId);
  });

  if (problems.length > 0) {
    throw new PlanError(problems);
  }

  // From the snapshot, not from `bills`: the import compares what it wrote with v1.
  const perAccount = new Map<string, Totals>();
  const perUser = new Map<string, Totals>();
  const add = (totals: Map<string, Totals>, key: string, cents: number) => {
    const t = totals.get(key) ?? { bills: 0, cents: 0 };
    t.bills++;
    t.cents += cents;
    totals.set(key, t);
  };
  for (const b of snapshot.bills) {
    const user = kept.get(b.userId);
    const cents = toCents(b.price);
    if (!user || cents === 0) continue;
    const accountId =
      b.accountId === null
        ? user.personalAccountId
        : accountIds.get(b.accountId)!;
    add(perAccount, accountId, cents);
    add(perUser, user.id, cents);
  }
  return {
    accounts,
    members,
    shops: lists.shops,
    categories: lists.categories,
    subscriptions: subscriptionPlans.map((s) => s.row),
    bills,
    photos,
    v1Totals: {
      perAccount: [...perAccount].map(([accountId, t]) => ({
        accountId,
        ...t,
      })),
      perUser: [...perUser].map(([userId, t]) => ({ userId, ...t })),
    },
    report,
  };
}

function cutName(name: string, label: string, report: PlanReport): string {
  if (Array.from(name).length <= NAME_MAX) return name;
  report.fixUps.push(`${label}: name cut to ${NAME_MAX} characters`);
  return cutCodePoints(name, NAME_MAX);
}
