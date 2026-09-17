import type { SnackSale } from "./ops";

/**
 * "Repeat order" suggestions — all knobs live here so the behaviour can be
 * tuned without touching any component.
 */
export const FREQUENT_ITEMS_LIMIT = 6; // max chips shown
export const FREQUENT_ITEMS_MIN_VISITS = 1; // show a chip after this many past purchases

export type FrequentItem = {
  item_name: string;
  timesBought: number;
  lastBoughtOn: string;
};

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/**
 * Ranks a customer's past snack purchases so the billing screen can offer a
 * one-tap "usually orders" row. Pure function — no I/O — so it's trivial to
 * unit-test and safe to reuse anywhere sales history + a customer name are
 * available (SnacksTab, a future customer profile page, etc).
 *
 * Ranking: most-frequently-bought item first, ties broken by most recent.
 */
export function frequentItemsForCustomer(
  sales: SnackSale[],
  customerName: string,
  limit: number = FREQUENT_ITEMS_LIMIT,
): FrequentItem[] {
  const target = norm(customerName);
  if (!target) return [];

  const byItem = new Map<string, FrequentItem>();
  for (const sale of sales) {
    if (norm(sale.customer_name) !== target) continue;
    for (const line of sale.items ?? []) {
      const row = byItem.get(line.item_name) ?? {
        item_name: line.item_name,
        timesBought: 0,
        lastBoughtOn: sale.sale_date,
      };
      row.timesBought += 1;
      if (sale.sale_date > row.lastBoughtOn) row.lastBoughtOn = sale.sale_date;
      byItem.set(line.item_name, row);
    }
  }

  return [...byItem.values()]
    .filter((r) => r.timesBought >= FREQUENT_ITEMS_MIN_VISITS)
    .sort(
      (a, b) =>
        b.timesBought - a.timesBought ||
        (a.lastBoughtOn < b.lastBoughtOn ? 1 : -1),
    )
    .slice(0, limit);
}

/**
 * The customer's single most recent snack bill, for a one-tap "repeat last
 * order" action (as opposed to `frequentItemsForCustomer` above, which
 * ranks individual items across *all* their past orders).
 *
 * `sales` is expected pre-sorted newest-first (as `useSnackSales` already
 * returns it — created_at desc, then sale_date desc), so the first matching
 * row *is* the most recent order; this function doesn't re-sort.
 */
export function lastOrderForCustomer(
  sales: SnackSale[],
  customerName: string,
): SnackSale | null {
  const target = norm(customerName);
  if (!target) return null;
  return sales.find((s) => norm(s.customer_name) === target) ?? null;
}
