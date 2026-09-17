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
