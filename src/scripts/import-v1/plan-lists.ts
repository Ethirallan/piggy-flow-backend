import { cutCodePoints, wallTimeToInstant } from './dates.js';
import { fixEmoji } from './fix-emoji.js';
import type { NewCategory, NewShop, PlanReport } from './plan.js';
import type { V1Category, V1Shop, V1Snapshot } from './v1-snapshot.js';

const NAME_MAX = 100;

export interface ListPlan {
  shops: NewShop[];
  categories: NewCategory[];
  shopFor(accountId: string, v1ShopId: number | null): string | null;
  categoryFor(accountId: string, v1CategoryId: number | null): string | null;
}

/** A kept bill or subscription: which v2 account uses which v1 shop / category. */
export interface ListUse {
  accountId: string;
  shopId: number | null;
  categoryId: number | null;
}

/**
 * Shops and categories per v2 account: a copy wherever kept rows use them,
 * one row per name (ignoring case) per account, unused ones in their owner's
 * Personal account (`unusedTarget` is null for dismissed owners: dropped).
 */
export function planLists(
  snapshot: V1Snapshot,
  uses: ListUse[],
  unusedTarget: (v1UserId: number) => string | null,
  newId: () => string,
  report: PlanReport,
  problems: string[],
): ListPlan {
  const shops = placeAll(
    'shop',
    snapshot.shops,
    uses.map((u) => [u.accountId, u.shopId]),
    unusedTarget,
    newId,
    report,
    problems,
  );
  const categories = placeAll(
    'category',
    snapshot.categories,
    uses.map((u) => [u.accountId, u.categoryId]),
    unusedTarget,
    newId,
    report,
    problems,
  );
  return {
    shops: shops.rows,
    categories: categories.rows.map((row) => {
      const first = categories.firstOf.get(row.id) as V1Category;
      const fixed = fixEmoji(first.emoji);
      if (fixed.changed) {
        report.fixUps.push(
          `category ${first.id}: emoji "${first.emoji}" → ${fixed.emoji === null ? 'dropped' : `"${fixed.emoji}"`}`,
        );
      }
      return { ...row, emoji: fixed.emoji };
    }),
    shopFor: (accountId, id) =>
      id === null ? null : (shops.ids.get(`${accountId}|${id}`) ?? null),
    categoryFor: (accountId, id) =>
      id === null ? null : (categories.ids.get(`${accountId}|${id}`) ?? null),
  };
}

function placeAll(
  kind: 'shop' | 'category',
  lists: V1Shop[],
  uses: [string, number | null][],
  unusedTarget: (v1UserId: number) => string | null,
  newId: () => string,
  report: PlanReport,
  problems: string[],
): { rows: NewShop[]; ids: Map<string, string>; firstOf: Map<string, V1Shop> } {
  // (v2 account, v1 id) pairs, in first-use order.
  const placements = new Map<string, { accountId: string; list: V1Shop }>();
  const byId = new Map(lists.map((l) => [l.id, l]));
  const used = new Set<number>();
  for (const [accountId, id] of uses) {
    if (id === null) continue;
    used.add(id);
    placements.set(`${accountId}|${id}`, { accountId, list: byId.get(id)! });
  }
  for (const list of lists) {
    const accountId = used.has(list.id) ? null : unusedTarget(list.userId);
    if (accountId)
      placements.set(`${accountId}|${list.id}`, { accountId, list });
  }

  // Group by (account, lower(trimmed name)).
  const groups = new Map<string, { accountId: string; lists: V1Shop[] }>();
  for (const { accountId, list } of placements.values()) {
    const name = list.name.trim();
    if (!name) {
      problems.push(`${kind} ${list.id}: blank name`);
      continue;
    }
    const key = `${accountId}|${name.toLowerCase()}`;
    const group = groups.get(key) ?? { accountId, lists: [] };
    group.lists.push(list);
    groups.set(key, group);
  }

  const rows: NewShop[] = [];
  const ids = new Map<string, string>();
  const firstOf = new Map<string, V1Shop>();
  for (const group of groups.values()) {
    group.lists.sort(
      (a, b) => a.created.localeCompare(b.created) || a.id - b.id,
    );
    const first = group.lists[0];
    let name = first.name.trim();
    if (Array.from(name).length > NAME_MAX) {
      name = cutCodePoints(name, NAME_MAX);
      report.fixUps.push(
        `${kind} ${first.id}: name cut to ${NAME_MAX} characters`,
      );
    }
    const id = newId();
    rows.push({
      id,
      accountId: group.accountId,
      name,
      createdAt: wallTimeToInstant(first.created, 'utc'),
      updatedAt: wallTimeToInstant(
        group.lists
          .map((l) => l.lastUpdate)
          .sort()
          .at(-1)!,
        'utc',
      ),
    });
    firstOf.set(id, first);
    for (const list of group.lists)
      ids.set(`${group.accountId}|${list.id}`, id);
    if (group.lists.length > 1) {
      report.merged.push({
        kind,
        accountId: group.accountId,
        name,
        v1Ids: group.lists.map((l) => l.id),
      });
    }
  }
  return { rows, ids, firstOf };
}
