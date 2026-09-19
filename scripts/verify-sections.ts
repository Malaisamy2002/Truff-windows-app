/**
 * Independent audit of every OTHER report/section built on top of
 * periodStats() — run with:  npx tsx scripts/verify-sections.ts
 *
 * verify-loadtest.ts already hand-verifies periodStats()'s own headline
 * figures over the full seeded year. This script instead checks the
 * sections built ON TOP of it — the ones a person actually sees in
 * Reports/Dashboard: month-by-month statsForMonth(), paymentSplit(),
 * expenseByCategory(), profitAndLoss(), taxReport(), duesAgeing(),
 * turfOccupancy() and itemPerformance() — each cross-checked against an
 * independent hand-sum over the same seeded rows, never against itself.
 *
 * This is also the regression test for a real bug this audit found and
 * fixed: loadtest.ts's `isoAt()` used to build bill_date from a bare
 * "date+hour" string parsed in the HOST MACHINE's local timezone, while
 * analytics.ts's monthKey()/dayKey() deliberately read every date back
 * assuming a fixed +5:30 IST offset (see the comment there). Bills were
 * seeded at hour 19 — 19:00 + 5:30 crosses midnight — so on any
 * non-IST-clocked machine (this sandbox, most CI runners, many dev
 * laptops), every bill silently landed a calendar day later than the
 * app would ever read it as, pushing bills seeded on the LAST day of a
 * month into the next month (and a Dec-31 bill into the next year,
 * outside the seeded window entirely). `isoAt()` now builds the IST
 * instant explicitly (Date.UTC + subtract the IST offset), so it comes
 * out right regardless of the host machine's own timezone. The
 * month-by-month sum-vs-annual check below is what originally caught
 * this — deleting it would silently re-open the same bug class.
 */
import "fake-indexeddb/auto";

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

const { seedLoadTestData, clearLoadTestData, loadTestYear } =
  await import("../src/lib/loadtest");
const {
  periodStats,
  statsForMonth,
  paymentSplit,
  expenseByCategory,
  profitAndLoss,
  taxReport,
  duesAgeing,
  turfOccupancy,
  itemPerformance,
} = await import("../src/lib/analytics");
const { bookingDue } = await import("../src/lib/dues");
const { db } = await import("../src/lib/localdb");

// Deliberately loose: this audit hands the analytics functions raw Dexie rows
// cast through one shared shape instead of importing every row type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>;

let failures = 0;
function check(label: string, actual: number, expected: number, eps = 0.51) {
  const ok = Math.abs(actual - expected) < eps;
  if (!ok) failures++;
  console.log(
    `${ok ? "  ok  " : "  FAIL"} ${label.padEnd(60)} got ${String(actual).padStart(12)}  expected ${String(expected).padStart(12)}`,
  );
}

const mix = (process.argv[2] as "light" | "medium") ?? "medium";
await clearLoadTestData();
await seedLoadTestData(mix);
const [bills, bookings, sales, expenses, tabEntries] = await Promise.all([
  db.bills.toArray(),
  db.turf_bookings.toArray(),
  db.snack_sales.toArray(),
  db.expenses.toArray(),
  db.tab_entries.toArray(),
]);
const year = loadTestYear();
const inYear = (iso: string) => String(iso).startsWith(String(year));
const src = { bills, bookings, sales, expenses, tabEntries } as never;
const annual = periodStats(src, inYear);

console.log(
  `\n=== Month-by-month statsForMonth sums vs annual periodStats ===`,
);
const months: string[] = [];
for (let m = 1; m <= 12; m++)
  months.push(`${year}-${String(m).padStart(2, "0")}`);
const monthly = months.map((k) => statsForMonth(src, k));
for (const field of [
  "billsRevenue",
  "billsCollected",
  "billsDues",
  "turfRevenue",
  "snacksRevenue",
  "tax",
  "netRevenue",
  "revenue",
  "collected",
  "tabCollected",
  "expenses",
  "profit",
  "dues",
  "snackProfit",
] as const) {
  const sum = monthly.reduce(
    (n, s) => n + (s as unknown as Record<string, number>)[field]!,
    0,
  );
  check(
    `sum(statsForMonth.${field}) over 12 months == annual`,
    sum,
    (annual as unknown as Record<string, number>)[field]!,
  );
}

console.log(`\n=== paymentSplit vs periodStats.collected ===`);
const split = paymentSplit(src, inYear);
check(
  "sum(paymentSplit) == periodStats.collected",
  split.reduce((n, x) => n + x.value, 0),
  annual.collected,
);

console.log(`\n=== expenseByCategory vs periodStats.expenses ===`);
const cats = expenseByCategory(src, inYear);
check(
  "sum(expenseByCategory) == periodStats.expenses",
  cats.reduce((n, x) => n + x.value, 0),
  annual.expenses,
);

console.log(`\n=== profitAndLoss rows vs statsForMonth ===`);
const pnl = profitAndLoss(src, months);
for (let i = 0; i < months.length; i++) {
  check(
    `P&L[${months[i]}].Revenue == statsForMonth.revenue`,
    pnl[i]!.Revenue,
    monthly[i]!.revenue,
  );
  check(
    `P&L[${months[i]}].Profit == statsForMonth.profit`,
    pnl[i]!.Profit,
    monthly[i]!.profit,
  );
}

console.log(`\n=== taxReport vs periodStats (per month) ===`);
const tax = taxReport(src, months);
for (let i = 0; i < months.length; i++) {
  check(
    `taxReport[${months[i]}].taxableValue == statsForMonth.netRevenue`,
    tax[i]!.taxableValue,
    monthly[i]!.netRevenue,
  );
  check(
    `taxReport[${months[i]}].totalTax == statsForMonth.tax`,
    tax[i]!.totalTax,
    monthly[i]!.tax,
  );
  const lineSum = tax[i]!.lines.reduce((n, l) => n + l.value, 0);
  check(
    `taxReport[${months[i]}].lines sum == totalTax`,
    lineSum,
    tax[i]!.totalTax,
  );
  check(
    `taxReport[${months[i]}].grossValue == taxableValue+totalTax`,
    tax[i]!.grossValue,
    tax[i]!.taxableValue + tax[i]!.totalTax,
  );
}

console.log(`\n=== duesAgeing vs hand-summed bookingDue() ===`);
const ageing = duesAgeing(
  bookings as AnyRow[],
  Date.now(),
  tabEntries as AnyRow[],
);
const ageingTotal = ageing.reduce((n, r) => n + r.amount, 0);
const ageingCount = ageing.reduce((n, r) => n + r.count, 0);
let handDuesTotal = 0;
let handDuesCount = 0;
for (const b of bookings as AnyRow[]) {
  const isFin = b.status !== "Cancelled" && !b.merged_into_bill_id;
  if (!isFin) continue;
  const due = bookingDue(b, tabEntries as never);
  if (due > 0) {
    handDuesTotal += due;
    handDuesCount++;
  }
}
check(
  "duesAgeing total amount == hand-summed bookingDue() over all financial bookings",
  ageingTotal,
  handDuesTotal,
);
check(
  "duesAgeing total count == hand-summed count",
  ageingCount,
  handDuesCount,
);

console.log(`\n=== turfOccupancy vs periodStats/hand-calc (full year) ===`);
const occ = turfOccupancy(bookings as AnyRow[], inYear, tabEntries as AnyRow[]);
check(
  "turfOccupancy.revenue == periodStats.turfRevenue",
  occ.revenue,
  annual.turfRevenue,
);
check(
  "turfOccupancy.bookingCount == count of financial bookings in year",
  occ.bookingCount,
  (bookings as AnyRow[]).filter(
    (b) =>
      inYear(b.booking_date) &&
      b.status !== "Cancelled" &&
      !b.merged_into_bill_id,
  ).length,
);
const weekdaySum = occ.byWeekday.reduce((n, r) => n + r.revenue, 0);
check(
  "sum(byWeekday.revenue) == turfOccupancy.revenue",
  weekdaySum,
  occ.revenue,
);
// byHour splits each booking's revenue proportionally across the clock
// hours it spans. It used to round EACH hour bucket to a whole rupee
// independently, which could drift a rupee or two from the (also rounded)
// total — display-rounding noise. That's now fixed: turfOccupancy() uses
// allocateWhole() (money.ts) to reconcile the 24 buckets to the exact
// whole-rupee total actually attributable to hours, so this must now match
// exactly whenever every booking in the period has a start/end time (true
// for the load-test generator). A real gap can still appear if a booking
// has no start/end time at all (nothing to attribute to an hour) — that's
// a different, legitimate case, not rounding noise, and isn't exercised by
// this generator.
const hourSum = occ.byHour.reduce((n, r) => n + r.revenue, 0);
check(
  "sum(byHour.revenue) == turfOccupancy.revenue (exact — allocateWhole)",
  hourSum,
  occ.revenue,
);
let handUnpaidCount = 0;
let handUnpaidAmt = 0;
for (const b of bookings as AnyRow[]) {
  if (!inYear(b.booking_date)) continue;
  const isFin = b.status !== "Cancelled" && !b.merged_into_bill_id;
  if (!isFin) continue;
  const due = bookingDue(b, tabEntries as never);
  if (due > 0) {
    handUnpaidCount++;
    handUnpaidAmt += due;
  }
}
check("turfOccupancy.unpaid.count", occ.unpaid.count, handUnpaidCount);
check("turfOccupancy.unpaid.amount", occ.unpaid.amount, handUnpaidAmt);
let handCancelledCount = 0;
let handCancelledAmt = 0;
for (const b of bookings as AnyRow[]) {
  if (!inYear(b.booking_date)) continue;
  if (b.status === "Cancelled") {
    handCancelledCount++;
    handCancelledAmt += b.total_amount ?? 0;
  }
}
check("turfOccupancy.cancelled.count", occ.cancelled.count, handCancelledCount);
check("turfOccupancy.cancelled.amount", occ.cancelled.amount, handCancelledAmt);

console.log(
  `\n=== itemPerformance vs periodStats snacksRevenue/snackProfit ===`,
);
const items = itemPerformance(sales as AnyRow[], inYear, 999999);
const itemRevSum = items.rows.reduce((n, r) => n + r.revenue, 0);
const itemProfitSum = items.rows.reduce((n, r) => n + r.profit, 0);
check(
  "sum(itemPerformance.revenue) == periodStats.snacksRevenue",
  itemRevSum,
  annual.snacksRevenue,
);
check(
  "sum(itemPerformance.profit) == periodStats.snackProfit",
  itemProfitSum,
  annual.snackProfit,
);

console.log(
  `\n${failures === 0 ? "ALL SECTION CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`,
);
await clearLoadTestData();
process.exit(failures === 0 ? 0 : 1);
