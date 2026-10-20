import type { V1Snapshot } from './v1-snapshot.js';
import type { NewCategory, NewShop, PlanReport } from './plan.js';

/** v2 shop / category ids per (v2 account, v1 id); filled in by Task 3. */
export interface ListPlan {
  shops: NewShop[];
  categories: NewCategory[];
  shopFor(accountId: string, v1ShopId: number | null): string | null;
  categoryFor(accountId: string, v1CategoryId: number | null): string | null;
}

export interface ListUse {
  accountId: string;
  shopId: number | null;
  categoryId: number | null;
}

export function planLists(
  _snapshot: V1Snapshot,
  _uses: ListUse[],
  _unusedTarget: (v1UserId: number) => string | null,
  _newId: () => string,
  _report: PlanReport,
  _problems: string[],
): ListPlan {
  return {
    shops: [],
    categories: [],
    shopFor: () => null,
    categoryFor: () => null,
  };
}
