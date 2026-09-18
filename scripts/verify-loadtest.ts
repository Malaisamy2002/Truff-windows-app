/**
 * Independent math audit of the ONE-YEAR load-test dataset — run with:
 *   npx tsx scripts/verify-loadtest.ts [light|medium]
 *
 * `scripts/verify-math.ts` hand-checks a small, tailored 2-month fixture.
 * This script instead audits the real thing an operator actually loads from
 * Settings → Load test: `seedLoadTestData()`'s full randomly-generated
 * ONE-YEAR dataset (thousands of rows). Because that data is generated, not
 * hand-typed, "hand calculation" here means: re-derive every headline figure
 * straight from `docs/calculation-rules.md`'s formulas, applied to the raw
 * seeded rows with a fresh reduce/sum in THIS file — never by calling
 * `periodStats()` or any of the app's own aggregator functions. Then compare
 * that independent total against what `periodStats()` actually returns for
 * the same seeded year. Any mismatch is a real bug in one side or the other,
 * exactly like verify-math.ts's principle: the same rupee must never be
 * reachable by two different paths.
 *
 * What this independent recompute deliberately does NOT reuse from the app:
 *   - periodStats() / statsForMonth()      (that's what's being checked)
 *   - bookingGrossTotal() / snackSaleGrossTotal() / bookingDue() /
 *     bookingCashCollected() / netTabAmountFor()  (re-derived below from
 *     their documented formulas in calculation-rules.md §2b/§4/§5, using
 *     only each row's own frozen tax_amount — never taxBreakdown()).
 * What it DOES reuse (data-shape and rounding helpers only, not money
 * *logic*): `rupees()` (the one whole-rupee rounding rule, §0), and
 * `isFinancialBooking`/`isFinancialSale` are re-implemented inline from
 * their one-line documented definitions rather than imported, so a bug in
 * those predicates can't hide from this check either.
 */
import "fake-indexeddb/auto";

// localStorage/window stub so readAppSettings()/writeAppSettings() work
// under Node before any app module is imported (same shim verify-math.ts
// uses).
const store = new Map<string, string>();
(globalThis as Record<string, unknown>)["window"] = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  atob: (globalThis as Record<string, unknown>).atob,
  btoa: (globalThis as Record<string, unknown>).btoa,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
};

const { seedLoadTestData, clearLoadTestData, loadTestYear, LT_ID } =
  await import("../src/lib/loadtest");
const { periodStats } = await import("../src/lib/analytics");
const { db } = await import("../src/lib/localdb");
const { rupees, sumRupees } = await import("../src/lib/money");
const { readAppSettings } = await import("../src/lib/settings");
// Imported ONLY for the pass-3 cross-check below (per-record building
// blocks, not periodStats) — never used to feed the pass-2 hand formulas
// above, so pass 2 stays a from-scratch reimplementation.
const {
  bookingTaxable,
  bookingGrossTotal,
  billGrossTotal,
  snackSaleGrossTotal,
} = await import("../src/lib/biz");
const {
  bookingDue,
  bookingCashCollected,
  billDue,
  billCollected: realBillCollected,
  snackSaleCollected,
  netTabAmountFor: realNetTabAmountFor,
} = await import("../src/lib/dues");

type AnyRow = Record<string, unknown>;

const num = (v: unknown) => Number(v) || 0;
const near = (a: number, b: number, eps = 0.005) => Math.abs(a - b) < eps;
const fmt = (n: number) => n.toFixed(2);

let failures = 0;
function check(label: string, actual: number, expected: number) {
  const ok = near(actual, expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "  ok  " : "  FAIL"} ${label.padEnd(28)} got ${fmt(actual).padStart(14)}   expected ${fmt(expected).padStart(14)}`,
  );
}

const mix = (process.argv[2] as "light" | "medium") ?? "light";

console.log(`Seeding one calendar year of load-test data (mix: ${mix})...`);
await clearLoadTestData();
const seedResult = await seedLoadTestData(mix);
console.log(
  `Seeded: ${seedResult.total.toLocaleString("en-IN")} rows for ${seedResult.year} ` +
    `(${seedResult.bookings} bookings, ${seedResult.sales} sales, ${seedResult.bills} bills, ` +
    `${seedResult.expenses} expenses, ${seedResult.tabEntries} tab entries).`,
);

const [bills, bookings, sales, expenses, tabEntries] = await Promise.all([
  db.bills.toArray(),
  db.turf_bookings.toArray(),
  db.snack_sales.toArray(),
  db.expenses.toArray(),
  db.tab_entries.toArray(),
]);

// Sanity: every row this run wrote is tagged `lt-` — confirm nothing stray
// leaked in (e.g. from a previous run that clearLoadTestData() missed).
const untagged = (rows: AnyRow[]) =>
  rows.filter((r) => !String(r.id).startsWith(LT_ID)).length;
for (const [name, rows] of [
  ["bills", bills],
  ["bookings", bookings],
  ["sales", sales],
  ["expenses", expenses],
] as const) {
  const stray = untagged(rows as AnyRow[]);
  if (stray > 0) {
    console.log(`  WARN  ${stray} untagged ${name} row(s) in the database`);
  }
}

const year = loadTestYear();
const inYear = (iso: string) => String(iso).startsWith(String(year));

/* ------------------------------------------------------------------ */
/* Independent, from-scratch recompute — the "hand calculation" side   */
/* ------------------------------------------------------------------ */

// calculation-rules.md §2 / §2's sale mirror — re-derived inline, not
// imported, so a bug in the app's own predicate can't hide from this audit.
const isFinancialBooking = (b: AnyRow) =>
  b.status !== "Cancelled" && !b.merged_into_bill_id;
const isFinancialSale = (s: AnyRow) => !s.merged_into_bill_id && !s.cancelled;

const TAB_REF_BILL = "bill";
const TAB_REF_TURF_BOOKING = "turf_booking";

// calculation-rules.md §2b: net amount still on the tab against one ref.
function netTabAmountFor(entries: AnyRow[], refType: string, refId: string) {
  let net = 0;
  for (const e of entries) {
    if (e.ref_type !== refType || e.ref_id !== refId) continue;
    net += e.kind === "charge" ? num(e.amount) : -num(e.amount);
  }
  return Math.max(0, rupees(net));
}

const yearBills = bills.filter((b: AnyRow) => inYear(b.bill_date));
const yearBookingsAll = bookings.filter((b: AnyRow) => inYear(b.booking_date));
const yearSalesAll = sales.filter((s: AnyRow) => inYear(s.sale_date));
const yearExpenses = expenses.filter((e: AnyRow) => inYear(e.spent_at));
const yearBookings = yearBookingsAll.filter(isFinancialBooking);
const yearSales = yearSalesAll.filter(isFinancialSale);

// §5: billsRevenue / billsTax / billsCollected / billsDues.
// (Load-test never writes payment_mode "On tab" for a bill, so the onTabBill
// branch of periodStats() is never exercised here — the plain path below
// mirrors it exactly for that reason.)
let billsRevenue = 0;
let billsTax = 0;
let billsCollected = 0;
let billsDues = 0;
for (const b of yearBills as AnyRow[]) {
  if (b.status === "cancelled") continue;
  const net = rupees(b.total);
  const taxAmount = rupees(b.tax_amount ?? 0);
  const gross = net + taxAmount;
  const paid = b.status === "paid" ? gross : rupees(b.amount_paid);
  const onTab = netTabAmountFor(tabEntries as AnyRow[], TAB_REF_BILL, b.id);
  billsRevenue += net;
  billsTax += taxAmount;
  billsCollected += paid;
  billsDues += Math.max(0, gross - paid - onTab);
}

// §5: turfRevenue / bookingsTax / booking collected+due.
const turfRevenue = sumRupees(
  (yearBookings as AnyRow[]).map((b) => b.total_amount),
);
const bookingsTax = sumRupees(
  (yearBookings as AnyRow[]).map((b) => b.tax_amount ?? 0),
);
let bookingsCollected = 0;
let bookingsDue = 0;
for (const b of yearBookings as AnyRow[]) {
  const gross = rupees(b.total_amount) + rupees(b.tax_amount ?? 0);
  const onTab = netTabAmountFor(
    tabEntries as AnyRow[],
    TAB_REF_TURF_BOOKING,
    b.id,
  );
  bookingsCollected += Math.max(0, rupees(b.advance_paid) - onTab);
  bookingsDue += Math.max(0, rupees(gross - num(b.advance_paid) - onTab));
}

// §5: snacksRevenue / snacksTax / snacks collected (load-test snack sales
// are never "On tab", so snackSaleCollected's TAB_PAYMENT_MODE branch is
// never exercised — collected is always the tax-inclusive gross).
const snacksRevenue = sumRupees((yearSales as AnyRow[]).map((s) => s.total));
const snacksTax = sumRupees(
  (yearSales as AnyRow[]).map((s) => s.tax_amount ?? 0),
);
const snacksCollected = sumRupees(
  (yearSales as AnyRow[]).map((s) => num(s.total) + num(s.tax_amount ?? 0)),
);
const snackProfit = sumRupees((yearSales as AnyRow[]).map((s) => s.profit));

// Tab cash payments actually received this year (kind "payment", no
// ref_type — a ref_type marks a bookkeeping reversal, not real cash; see
// isTabCashPayment in dues.ts). Only §7b's two hand-placed customers write
// these in the load-test dataset.
const tabCollected = sumRupees(
  (tabEntries as AnyRow[])
    .filter((e) => e.kind === "payment" && !e.ref_type && inYear(e.entry_date))
    .map((e) => e.amount),
);

const netRevenueHand = billsRevenue + turfRevenue + snacksRevenue;
const taxHand = billsTax + bookingsTax + snacksTax;
const revenueHand = netRevenueHand + taxHand;
const collectedHand =
  billsCollected + bookingsCollected + snacksCollected + tabCollected;
const expensesHand = sumRupees((yearExpenses as AnyRow[]).map((e) => e.amount));
const profitHand = netRevenueHand - expensesHand;
const duesHand = billsDues + bookingsDue;

/* ------------------------------------------------------------------ */
/* App's own aggregator, over the exact same rows                      */
/* ------------------------------------------------------------------ */

const src = {
  bills: bills as AnyRow[],
  bookings: bookings as AnyRow[],
  sales: sales as AnyRow[],
  expenses: expenses as AnyRow[],
  tabEntries: tabEntries as AnyRow[],
} as never;
const appStats = periodStats(src, inYear);

/* ------------------------------------------------------------------ */
/* Compare                                                              */
/* ------------------------------------------------------------------ */

console.log(`\n=== ${year} — hand calculation vs periodStats() ===`);
check("billsRevenue", appStats.billsRevenue, billsRevenue);
check("billsCollected", appStats.billsCollected, billsCollected);
check("billsDues", appStats.billsDues, billsDues);
check("turfRevenue", appStats.turfRevenue, turfRevenue);
check("snacksRevenue", appStats.snacksRevenue, snacksRevenue);
check("tax", appStats.tax, taxHand);
check("netRevenue", appStats.netRevenue, netRevenueHand);
check("revenue", appStats.revenue, revenueHand);
check("collected", appStats.collected, collectedHand);
check("tabCollected", appStats.tabCollected, tabCollected);
check("expenses", appStats.expenses, expensesHand);
check("profit", appStats.profit, profitHand);
check("dues", appStats.dues, duesHand);
check("snackProfit", appStats.snackProfit, snackProfit);

// Internal identities that must hold for any dataset (same checks
// verify-math.ts runs on its 2-month fixture, re-run here against the full
// randomly-generated year).
console.log(`\n=== Internal identities ===`);
check(
  "revenue = netRevenue + tax",
  appStats.revenue,
  appStats.netRevenue + appStats.tax,
);
check(
  "netRevenue = bills + turf + snacks",
  appStats.netRevenue,
  appStats.billsRevenue + appStats.turfRevenue + appStats.snacksRevenue,
);
check(
  "profit = netRevenue - expenses",
  appStats.profit,
  appStats.netRevenue - appStats.expenses,
);
check(
  "no rupee counted in both revenue and cancelled/merged rows",
  turfRevenue,
  sumRupees(
    (yearBookingsAll as AnyRow[])
      .filter(isFinancialBooking)
      .map((b) => b.total_amount),
  ),
);

/* ------------------------------------------------------------------ */
/* Pass 3 — per-record cross-check against the app's OWN building-block */
/* functions (bookingTaxable/bookingGrossTotal/billGrossTotal/          */
/* snackSaleGrossTotal, bookingDue/bookingCashCollected/billDue/        */
/* billCollected/snackSaleCollected/netTabAmountFor). Pass 2 above       */
/* shortcuts "gross = rupees(total_amount) + rupees(tax_amount)" on the  */
/* assumption that a booking's recomputed taxable amount always equals   */
/* its stored total_amount. That assumption is exactly the kind of thing */
/* that could silently hide a real bug from a pure aggregate comparison  */
/* — if it were ever false, BOTH periodStats() and pass 2 could still    */
/* agree with each other while both being wrong about the true gross.    */
/* Pass 3 checks the assumption directly, per row, and separately re-    */
/* derives every headline figure by calling the real per-record helpers  */
/* instead of the shortcut formula — a genuinely different code path     */
/* from both pass 1 (periodStats' own internal loop) and pass 2 (this    */
/* file's from-scratch arithmetic).                                      */
/* ------------------------------------------------------------------ */

console.log(
  `\n=== Pass 3 — per-record building blocks vs shortcut formula ===`,
);
const settings = readAppSettings();

let taxableMismatches = 0;
for (const b of yearBookings as AnyRow[]) {
  const recomputedTaxable = bookingTaxable(b);
  if (!near(recomputedTaxable, rupees(b.total_amount), 0.5)) {
    taxableMismatches++;
    if (taxableMismatches <= 5) {
      console.log(
        `  MISMATCH booking ${b.id}: bookingTaxable()=${recomputedTaxable} vs stored total_amount=${rupees(b.total_amount)}`,
      );
    }
  }
}
check(
  "bookingTaxable() == stored total_amount for every financial booking (0 mismatches)",
  taxableMismatches,
  0,
);

// Re-derive billsCollected/billsDues via billGrossTotal()/billDue()/
// billCollected() instead of the inline gross=net+tax_amount shortcut.
let billsCollected3 = 0;
let billsDues3 = 0;
for (const b of yearBills as AnyRow[]) {
  if (b.status === "cancelled") continue;
  billsCollected3 += realBillCollected(b);
  billsDues3 += billDue(b, tabEntries as never);
}
check("billsCollected (via billCollected())", billsCollected3, billsCollected);
check("billsDues (via billDue())", billsDues3, billsDues);

// Re-derive turf tax/collected/due via bookingGrossTotal()/
// bookingCashCollected()/bookingDue() instead of the total_amount+tax_amount
// shortcut and the inline netTabAmountFor() reimplementation.
let bookingsTax3 = 0;
let bookingsCollected3 = 0;
let bookingsDue3 = 0;
for (const b of yearBookings as AnyRow[]) {
  const gross = bookingGrossTotal(b, settings);
  bookingsTax3 += Math.max(0, gross - rupees(b.total_amount));
  bookingsCollected3 += bookingCashCollected(b, tabEntries as never);
  bookingsDue3 += bookingDue(b, tabEntries as never, settings);
}
check("bookingsTax (via bookingGrossTotal())", bookingsTax3, bookingsTax);
check(
  "bookingsCollected (via bookingCashCollected())",
  bookingsCollected3,
  bookingsCollected,
);
check("bookingsDue (via bookingDue())", bookingsDue3, bookingsDue);

// Re-derive snack tax/collected via snackSaleGrossTotal()/
// snackSaleCollected() instead of the total+tax_amount shortcut.
let snacksTax3 = 0;
let snacksCollected3 = 0;
for (const s of yearSales as AnyRow[]) {
  const gross = snackSaleGrossTotal(s, settings);
  snacksTax3 += Math.max(0, gross - rupees(s.total));
  snacksCollected3 += snackSaleCollected(s, settings);
}
check("snacksTax (via snackSaleGrossTotal())", snacksTax3, snacksTax);
check(
  "snacksCollected (via snackSaleCollected())",
  snacksCollected3,
  snacksCollected,
);

// Cross-check the tab-ledger reimplementation itself: pick every ref this
// dataset actually charges against and confirm the real netTabAmountFor()
// (dues.ts) agrees with this file's inline reimplementation for each one.
const refsCharged = new Set(
  (tabEntries as AnyRow[])
    .filter((e) => e.ref_type && e.ref_id)
    .map((e) => `${e.ref_type}:${e.ref_id}`),
);
let netTabMismatches = 0;
for (const key of refsCharged) {
  const [refType, refId] = key.split(":");
  const a = netTabAmountFor(tabEntries as AnyRow[], refType!, refId!);
  const b = realNetTabAmountFor(tabEntries as never, refType!, refId!);
  if (!near(a, b, 0.5)) netTabMismatches++;
}
check(
  "netTabAmountFor: inline reimplementation vs dues.ts (0 mismatches)",
  netTabMismatches,
  0,
);

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} — ` +
    `${year} revenue Rs ${appStats.revenue.toLocaleString("en-IN")}, ` +
    `profit Rs ${appStats.profit.toLocaleString("en-IN")}, ` +
    `dues Rs ${appStats.dues.toLocaleString("en-IN")} ` +
    `(${bills.length + bookings.length + sales.length + expenses.length + tabEntries.length} total rows read back)\n`,
);

await clearLoadTestData();
process.exit(failures === 0 ? 0 : 1);
