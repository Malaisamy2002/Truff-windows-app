/**
 * The ONE rounding + formatting rule for every rupee in the app.
 *
 * Policy (agreed before the live trial):
 * - Every payable / displayed amount is a WHOLE rupee. No paise anywhere.
 * - Rounding happens once, at the point an amount becomes payable
 *   (line total, discount, each tax line, grand total) — never twice on the
 *   same money, so a bill's parts always add up to its total on screen.
 * - Discounts are applied BEFORE tax: taxable = subtotal - discount.
 *
 * Anything that formats or totals money must use these helpers instead of
 * `toFixed`, `Math.round(x*100)/100`, or its own `toLocaleString` call.
 */

/** Whole-rupee value, rounded half away from zero (so -0.5 -> -1, 0.5 -> 1). */
export function rupees(n: unknown): number {
  const v = Number(n) || 0;
  return v < 0 ? -Math.round(-v) : Math.round(v);
}

/** Display string: whole rupees, Indian digit grouping. */
export function money(n: unknown): string {
  const v = rupees(n);
  return (v < 0 ? "-₹" : "₹") + Math.abs(v).toLocaleString("en-IN");
}

/**
 * Split a whole-rupee amount into two halves that add back to it exactly
 * (used for the CGST / SGST split — half of ₹101 is never ₹50.5 on a bill).
 */
export function splitHalf(total: number): [number, number] {
  const t = rupees(total);
  const first = rupees(t / 2);
  return [first, t - first];
}

/** Sum a list of amounts as whole rupees (each already rounded once). */
export const sumRupees = (values: number[]) =>
  values.reduce((s, v) => s + rupees(v), 0);

/**
 * Round several real-valued shares of one total into whole rupees that add
 * back to that total exactly — the many-bucket generalisation of
 * `splitHalf()`. Rounding N independent fractional buckets with plain
 * `rupees()` can drift a rupee or two from the true total purely from
 * rounding noise (e.g. a booking's revenue sliced across the hours of the
 * day it spans): each bucket looks right on its own, but 24 independent
 * roundings don't have to sum to the same whole rupee as rounding the
 * total once. The "largest remainder" method fixes that: floor every
 * share, then hand out the leftover rupees one at a time to the buckets
 * with the biggest fractional part, largest first — so every bucket stays
 * within one rupee of its raw share AND the buckets sum to exactly
 * `rupees(total)`.
 *
 * `total` is normally the sum of `shares` itself (pass it through
 * `rupees()` first, or omit it to have this derive it) — pass a different
 * total only when the shares deliberately don't cover the whole amount
 * (e.g. some records couldn't be bucketed at all), in which case the
 * buckets legitimately sum to less than the grand total, and that gap is
 * real, not rounding noise.
 */
export function allocateWhole(
  shares: number[],
  total: number = shares.reduce((s, v) => s + v, 0),
): number[] {
  if (shares.length === 0) return [];
  const floors = shares.map((s) => Math.floor(s));
  const base = floors.reduce((s, v) => s + v, 0);
  const remainder = rupees(total) - base;
  const order = shares
    .map((s, i) => ({ i, frac: s - floors[i]! }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  if (remainder > 0) {
    for (let k = 0; k < remainder; k++) {
      const idx = order[k % order.length]!.i;
      out[idx] = (out[idx] ?? 0) + 1;
    }
  } else if (remainder < 0) {
    for (let k = 0; k < -remainder; k++) {
      const idx = order[order.length - 1 - (k % order.length)]!.i;
      out[idx] = (out[idx] ?? 0) - 1;
    }
  }
  return out;
}
