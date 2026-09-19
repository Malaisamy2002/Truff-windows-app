/**
 * Independent math audit — run with:  bun scripts/verify-math.ts
 *
 * Builds two months of tailored, hand-checkable data (July + August 2026),
 * computes every headline figure BY HAND (literal arithmetic below), then
 * compares those literals against what the app's shared calculators return
 * (periodStats/statsForMonth in lib/analytics.ts, customerLifetimeStats in
 * lib/data.ts, taxBreakdown in lib/settings.ts, tabBalanceOf in lib/tabs.ts).
 *
 * Any mismatch is a real bug in one of those two sides — the point is that
 * the same money must never be reachable by two different paths
 * (docs/calculation-rules.md).
 */
import type { AppSettings } from "../src/lib/settings";

// A localStorage/window stub so readAppSettings() and Dexie-free helpers work
// under bun before any app module is imported.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>)["window"] = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
};

const {
  periodStats,
  statsForMonth,
  monthKey,
  dayKey,
  isFinancialBooking,
  paymentSplit,
  pctChange,
  taxReport,
} = await import("../src/lib/analytics");
const { taxBreakdown, DEFAULT_APP_SETTINGS } =
  await import("../src/lib/settings");
const { customerLifetimeStats } = await import("../src/lib/data");
const {
  bookingDue,
  bookingCashCollected,
  bookingMovedToDues,
  saleMovedToDues,
} = await import("../src/lib/dues");
const { tabBalanceOf, tabKey } = await import("../src/lib/tabs");

/* ------------------------------------------------------------------ setup */

// GST 18% + a 5% service charge => 23% of every bill's pre-tax total.
const settings: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  gstEnabled: true,
  gstRate: 18,
  customTaxes: [{ id: "svc", label: "Service Charge", rate: 5, enabled: true }],
};
const TAX = 0.23;
const JUL = "2026-07";
const AUG = "2026-08";

type AnyRec = Record<string, unknown>;

const bills = [
  // paid in full (amount_paid deliberately 0 — "paid" means gross collected)
  {
    id: "b1",
    invoice_no: "INV-1",
    customer_name: "Ravi",
    customer_phone: "9876543210",
    items: [],
    subtotal: 1000,
    discount: 0,
    total: 1000,
    amount_paid: 0,
    status: "paid",
    payment_mode: "Cash",
    bill_date: "2026-07-05T06:30:00.000Z",
  },
  // 31 Jul 20:00 UTC == 1 Aug 01:30 IST -> must land in AUGUST
  {
    id: "b2",
    invoice_no: "INV-2",
    customer_name: "Ravi",
    customer_phone: "9876543210",
    items: [],
    subtotal: 2000,
    discount: 0,
    total: 2000,
    amount_paid: 500,
    status: "partial",
    payment_mode: "UPI",
    bill_date: "2026-07-31T20:00:00.000Z",
  },
  {
    id: "b3",
    invoice_no: "INV-3",
    customer_name: "Priya",
    customer_phone: "9000000001",
    items: [],
    subtotal: 500,
    discount: 0,
    total: 500,
    amount_paid: 0,
    status: "unpaid",
    payment_mode: null,
    bill_date: "2026-07-10T05:00:00.000Z",
  },
  {
    id: "b4",
    invoice_no: "INV-4",
    customer_name: "Priya",
    customer_phone: "9000000001",
    items: [],
    subtotal: 1500,
    discount: 0,
    total: 1500,
    amount_paid: 0,
    status: "paid",
    payment_mode: "Cash",
    bill_date: "2026-08-12T05:00:00.000Z",
  },
] as unknown as Parameters<typeof periodStats>[0]["bills"];

const booking = (o: AnyRec) => ({
  status: "Confirmed",
  merged_into_bill_id: null,
  payment_mode: "Cash",
  snacks: [],
  snacks_total: 0,
  ...o,
});
const bookings = [
  booking({
    id: "k1",
    customer_name: "Ravi",
    phone: "9876543210",
    booking_date: "2026-07-04",
    total_amount: 1200,
    advance_paid: 400,
  }),
  booking({
    id: "k2",
    customer_name: "Priya",
    phone: "9000000001",
    booking_date: "2026-07-18",
    total_amount: 800,
    advance_paid: 800,
    status: "Completed",
  }),
  booking({
    id: "k3",
    customer_name: "Priya",
    phone: "9000000001",
    booking_date: "2026-07-20",
    total_amount: 600,
    advance_paid: 0,
    status: "Cancelled",
  }),
  booking({
    id: "k4",
    customer_name: "Ravi",
    phone: "9876543210",
    booking_date: "2026-07-25",
    total_amount: 900,
    advance_paid: 300,
    merged_into_bill_id: "b1",
  }),
  booking({
    id: "k5",
    customer_name: "Ravi",
    phone: "9876543210",
    booking_date: "2026-08-03",
    total_amount: 1000,
    advance_paid: 0,
  }),
  booking({
    id: "k6",
    customer_name: "Priya",
    phone: "9000000001",
    booking_date: "2026-08-22",
    total_amount: 1500,
    advance_paid: 1500,
    status: "Completed",
  }),
] as unknown as Parameters<typeof periodStats>[0]["bookings"];

const sales = [
  {
    id: "s1",
    customer_name: "Ravi",
    sale_date: "2026-07-06",
    total: 300,
    profit: 100,
    payment_mode: "Cash",
  },
  {
    id: "s2",
    customer_name: "Walk-in",
    sale_date: "2026-07-19",
    total: 200,
    profit: 80,
    payment_mode: "UPI",
  },
  {
    id: "s3",
    customer_name: "Priya",
    sale_date: "2026-08-09",
    total: 450,
    profit: 150,
    payment_mode: "Cash",
  },
] as unknown as Parameters<typeof periodStats>[0]["sales"];

const expenses = [
  { id: "e1", category: "ingredients", amount: 250, spent_at: "2026-07-07" },
  { id: "e2", category: "labour", amount: 150, spent_at: "2026-07-28" },
  { id: "e3", category: "transport", amount: 400, spent_at: "2026-08-14" },
] as unknown as Parameters<typeof periodStats>[0]["expenses"];

const src = { bills, bookings, sales, expenses };

/* ---------------- isolated regression fixtures: frozen booking/snack tax --
 * A separate month (September) so these don't disturb the Jul/Aug hand
 * arithmetic above. Before the fix, a booking's/sale's own frozen tax
 * (tax_amount, exactly as ops.ts freezes it at creation — see biz.ts's
 * TaxSnapshot) was charged and collected everywhere customer-facing
 * (receipts, Turf tab, Dues tab) but silently read as zero in
 * periodStats()/taxReport(), which feed the Dashboard, Reports and the GST
 * filing report. */
const SEP = "2026-09";
const taxedBooking = booking({
  id: "k7",
  customer_name: "Neha",
  phone: "9111111111",
  booking_date: "2026-09-05",
  total_amount: 1000,
  advance_paid: 1180, // fully paid, tax-inclusive gross
  tax_amount: 180, // frozen 18% GST
}) as unknown as Parameters<typeof periodStats>[0]["bookings"][number];
const taxedSale = {
  id: "s4",
  customer_name: "Neha",
  sale_date: "2026-09-05",
  total: 500,
  profit: 200,
  payment_mode: "Cash",
  tax_amount: 90, // frozen 18% GST
} as unknown as Parameters<typeof periodStats>[0]["sales"][number];
const srcSep = {
  bills: [],
  bookings: [...bookings, taxedBooking],
  sales: [...sales, taxedSale],
  expenses: [],
};

/* --------------------------------------------------- hand-computed truth */

const grossOf = (net: number) => net + net * TAX;

// None of k1/k2/k4/k5/k6 or s1/s2/s3 carry a frozen tax_amount (that's only
// set by ops.ts's freezeTax() at real creation time — these are seeded
// directly). With GST switched on for this whole dataset, biz.ts's
// grossWithTax() falls back to taxing them live too, exactly like a legacy
// pre-snapshot bill would (calculation-rules.md §4: "wherever GST is
// switched on" isn't bills-only — k7/s4's frozen-tax regression below is
// the OTHER half of that same rule). k3 is cancelled and k4 is merged, so
// neither is financial and neither is taxed.
const expectedJul = {
  billsRevenue: 1000 + 500,
  // Bills' tax, plus k1+k2's and s1+s2's own live tax fallback.
  tax: (1000 + 500) * TAX + (1200 + 800) * TAX + (300 + 200) * TAX,
  turfRevenue: 1200 + 800, // k3 cancelled, k4 merged -> both excluded
  snacksRevenue: 300 + 200,
  netRevenue: 1500 + 2000 + 500,
  revenue:
    1500 +
    2000 +
    500 +
    ((1000 + 500) * TAX + (1200 + 800) * TAX + (300 + 200) * TAX),
  collected:
    grossOf(1000) /* b1 */ +
    0 /* b3 */ +
    (400 +
      800) /* advances: bookingCashCollected reads advance_paid raw, never tax-inclusive */ +
    (grossOf(300) +
      grossOf(200)) /* snacks: snackSaleCollected IS tax-inclusive */,
  expenses: 400,
  profit: 4000 - 400,
  dues:
    grossOf(500) - 0 /* b3 */ + (grossOf(1200) - 400) + (grossOf(800) - 800),
  snackProfit: 180,
};

const expectedAug = {
  billsRevenue: 2000 + 1500,
  // Bills' tax, plus k5+k6's live tax fallback. s3's own tax is NOT 450 *
  // TAX (103.5): taxBreakdown() rounds each tax LINE to a whole rupee
  // before summing. GST's CGST and SGST halves are each rounded on their
  // own (settings.ts: they must be exactly equal, so no uneven split), so
  // 9% of 450 is 40.5 -> 41 for CGST and 41 for SGST (82, not the exact
  // 81), and 5% of 450 is 22.5 -> 23 for the service charge: s3's tax is
  // 41 + 41 + 23 = 105. This is the same per-line rounding taxBreakdown()'s
  // own "sum rounded parts, don't round the sum" rule uses everywhere else
  // (calculation-rules.md rule 3) — it just isn't visible on the other
  // round-hundred amounts in this fixture because 9%/5% of a multiple of
  // 100 is already a whole rupee.
  tax: (2000 + 1500) * TAX + (1000 + 1500) * TAX + 105,
  turfRevenue: 1000 + 1500,
  snacksRevenue: 450,
  netRevenue: 3500 + 2500 + 450,
  revenue:
    3500 + 2500 + 450 + ((2000 + 1500) * TAX + (1000 + 1500) * TAX + 105),
  collected:
    500 /* b2 partial */ +
    grossOf(1500) /* b4 */ +
    1500 /* advance (raw, not tax-inclusive) */ +
    (450 +
      105) /* s3: snackSaleCollected IS tax-inclusive, 450 + its 105 tax */,
  expenses: 400,
  profit: 6450 - 400,
  dues:
    grossOf(2000) - 500 /* b2 */ + (grossOf(1000) - 0) + (grossOf(1500) - 1500),
  snackProfit: 150,
};

/* ------------------------------------------------------------- harness */

let failures = 0;
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
const fmt = (n: unknown) => (typeof n === "number" ? n.toFixed(2) : String(n));

function check(label: string, actual: unknown, expected: unknown) {
  const ok =
    typeof actual === "number" && typeof expected === "number"
      ? near(actual, expected)
      : actual === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? "  ok  " : "  FAIL"} ${label.padEnd(46)} got ${fmt(actual).padStart(12)}   expected ${fmt(expected).padStart(12)}`,
  );
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

/* ------------------------------------------------------- 1. date buckets */

section("1. Date bucketing (IST vs UTC)");
check("bill b1 month", monthKey(bills[0]!.bill_date), JUL);
check(
  "bill b2 month (31 Jul 20:00 UTC -> IST Aug)",
  monthKey(bills[1]!.bill_date),
  AUG,
);
check("bill b2 day", dayKey(bills[1]!.bill_date), "2026-08-01");
check("booking k5 month (plain date)", monthKey("2026-08-03"), AUG);
check("expense e3 day (plain date)", dayKey("2026-08-14"), "2026-08-14");

/* ------------------------------------------------------------ 2. taxes */

section("2. Tax breakdown (GST 18% + Service 5%)");
const tb = taxBreakdown(1500, settings);
check("taxAmount on 1500", tb.taxAmount, 1500 * TAX);
check("line count (CGST+SGST+Service)", tb.lines.length, 3);
check("CGST half", tb.lines[0]!.value, (1500 * 0.18) / 2);
check("SGST half", tb.lines[1]!.value, (1500 * 0.18) / 2);
check("Service charge line", tb.lines[2]!.value, 1500 * 0.05);
check(
  "no tax when disabled",
  taxBreakdown(1500, DEFAULT_APP_SETTINGS).taxAmount,
  0,
);

/* -------------------------------------------------- 3. merge predicate */

section("3. isFinancialBooking");
check("plain booking counts", isFinancialBooking(bookings[0]!), true);
check("cancelled excluded", isFinancialBooking(bookings[2]!), false);
check("merged excluded", isFinancialBooking(bookings[3]!), false);

/* ----------------------------------------------- 4/5. monthly aggregates */

for (const [key, exp] of [
  [JUL, expectedJul],
  [AUG, expectedAug],
] as const) {
  section(
    `${key === JUL ? "4" : "5"}. ${key} monthly stats vs hand arithmetic`,
  );
  const s = statsForMonth(src, key, settings);
  for (const field of Object.keys(exp) as (keyof typeof exp)[]) {
    check(`${key} ${field}`, s[field], exp[field]);
  }
  // Internal identities that must hold for any dataset.
  check(`${key} revenue = netRevenue + tax`, s.revenue, s.netRevenue + s.tax);
  check(
    `${key} netRevenue = bills + turf + snacks`,
    s.netRevenue,
    s.billsRevenue + s.turfRevenue + s.snacksRevenue,
  );
  check(
    `${key} profit = netRevenue - expenses`,
    s.profit,
    s.netRevenue - s.expenses,
  );
}

/* ------------------------------------------- 6. two-month reconciliation */

section("6. Two months summed == one combined period");
const both = periodStats(
  src,
  (iso) => [JUL, AUG].includes(monthKey(iso)),
  settings,
);
const jul = statsForMonth(src, JUL, settings);
const aug = statsForMonth(src, AUG, settings);
for (const field of Object.keys(expectedJul) as (keyof typeof expectedJul)[]) {
  check(`combined ${field} = Jul + Aug`, both[field], jul[field] + aug[field]);
}
check(
  "combined revenue vs literal",
  both.revenue,
  expectedJul.revenue + expectedAug.revenue,
);
check(
  "no double counting: every rupee once",
  both.netRevenue,
  // bills(1000+2000+500+1500) + live bookings(1200+800+1000+1500) + snacks(300+200+450)
  5000 + 4500 + 950,
);

/* --------------------------------------------------- 7. payment split */

section("7. Payment split (money actually received)");
const splitJul = paymentSplit(src, (iso) => monthKey(iso) === JUL);
const splitOf = (name: string) =>
  splitJul.find((x) => x.name === name)?.value ?? 0;
// b1's amount_paid is 0 by design (status paid), but a paid bill's collected
// money is its full gross (billCollected()) — so its 1000 counts as Cash here,
// alongside advances 400+800 and snacks 300 cash / 200 UPI. paymentSplit()
// reads live app settings, which this script never installs (GST is passed
// explicitly to periodStats instead), so these figures are pre-tax.
check("Jul Cash", splitOf("Cash"), 1000 + 400 + 800 + 300);
check("Jul UPI", splitOf("UPI"), 200);
check(
  "Jul split total <= collected",
  splitOf("Cash") + splitOf("UPI") <= jul.collected,
  true,
);

/* ----------------------------------------------- 8. percentage change */

section("8. pctChange");
check("100 -> 150", pctChange(150, 100), 50);
check("from zero base", pctChange(150, 0), null);
check("zero to zero", pctChange(0, 0), 0);
check(
  "Jul->Aug revenue",
  pctChange(aug.revenue, jul.revenue),
  ((aug.revenue - jul.revenue) / jul.revenue) * 100,
);

/* --------------------------------------------- 9. per-customer rollups */

section("9. customerLifetimeStats (Ravi)");
const [ravi, priya] = customerLifetimeStats(
  [
    { id: "c1", name: "Ravi", phone: "9876543210" },
    { id: "c2", name: "Priya", phone: "9000000001" },
  ],
  src as never,
);
check("Ravi billsSpend", ravi!.billsSpend, 1000 + 2000);
check("Ravi turfSpend (k4 merged excluded)", ravi!.turfSpend, 1200 + 1000);
check("Ravi snacksSpend", ravi!.snacksSpend, 300);
check("Ravi totalSpend", ravi!.totalSpend, 3000 + 2200 + 300);
check("Ravi bookingsCount (merged counted)", ravi!.bookingsCount, 3);
check("Ravi avgBookingValue", ravi!.avgBookingValue, (1200 + 900 + 1000) / 3);
check(
  "Ravi outstandingTurfDues",
  ravi!.outstandingTurfDues,
  1200 - 400 + (1000 - 0),
);
check("Ravi firstActivity", ravi!.firstActivity, "2026-07-04");
check("Priya turfSpend (cancelled excluded)", priya!.turfSpend, 800 + 1500);
check("Priya outstandingTurfDues", priya!.outstandingTurfDues, 0);
check(
  "customer spend sum = netRevenue - walk-in snacks",
  ravi!.totalSpend + priya!.totalSpend,
  both.netRevenue - 200,
);

/* ------------------------------------------------------- 10. tab ledger */

section("10. Customer tab ledger");
const entry = (kind: "charge" | "payment", amount: number) =>
  ({ kind, amount }) as never;
check(
  "balance of charges - payments",
  tabBalanceOf([
    entry("charge", 200),
    entry("charge", 800),
    entry("payment", 500),
  ]),
  500,
);
check(
  "settled tab",
  tabBalanceOf([entry("charge", 250), entry("payment", 250)]),
  0,
);
// Whole-rupee rule (lib/money.ts): a tab balance never carries paise, and each
// entry is rounded once before it is summed — 3 × ₹0.60 is ₹3, not ₹1.80.
check(
  "whole rupees, rounded once (0.6*3)",
  tabBalanceOf([
    entry("charge", 0.6),
    entry("charge", 0.6),
    entry("charge", 0.6),
  ]),
  3,
);
check(
  "sub-rupee entries round to zero",
  tabBalanceOf([
    entry("charge", 0.1),
    entry("charge", 0.1),
    entry("charge", 0.1),
  ]),
  0,
);
check(
  "phone key wins",
  tabKey("Ravi Kumar", "+91 98765 43210"),
  "p:9876543210",
);
check(
  "typo-proof phone key",
  tabKey("Ravii", "9876543210"),
  tabKey("Ravi", "9876543210"),
);
check("name fallback", tabKey("  Ravi Kumar ", ""), "n:ravi kumar");
check(
  "tab dues are separate from booking dues",
  // Ravi's turf dues (800 + 1000) must NOT change when a tab charge exists
  ravi!.outstandingTurfDues,
  1800,
);

/* --------------------- 11. Frozen booking/snack tax (regression, Sep) */

section("11. Taxed booking + taxed snack sale — tax now visible everywhere");
// GST off in the ambient `settings` for this call on purpose: a record's own
// frozen tax_amount must count regardless of what the app's current tax
// settings are — exactly like a bill's frozen tax already does.
const sep = statsForMonth(srcSep, SEP, DEFAULT_APP_SETTINGS);
check("Sep turfRevenue (pre-tax, unchanged)", sep.turfRevenue, 1000);
check("Sep snacksRevenue (pre-tax, unchanged)", sep.snacksRevenue, 500);
check("Sep tax includes booking + snack GST (used to be 0)", sep.tax, 180 + 90);
check("Sep netRevenue", sep.netRevenue, 1500);
check("Sep revenue = netRevenue + tax", sep.revenue, 1500 + 270);
check("Sep collected (already tax-inclusive)", sep.collected, 1180 + 590);
check(
  "Sep collected reconciles with revenue (fully paid)",
  sep.collected,
  sep.revenue,
);

const sepTax = taxReport(srcSep, [SEP], DEFAULT_APP_SETTINGS)[0]!;
check("Sep taxReport taxableValue = netRevenue", sepTax.taxableValue, 1500);
check(
  "Sep taxReport totalTax (GST filing, used to be 0)",
  sepTax.totalTax,
  270,
);
check("Sep taxReport grossValue", sepTax.grossValue, 1770);

const [neha] = customerLifetimeStats(
  [{ id: "c3", name: "Neha", phone: "9111111111" }],
  srcSep as never,
);
check(
  "Neha outstandingTurfDues tax-inclusive (used to read total_amount - advance_paid)",
  neha!.outstandingTurfDues,
  bookingDue(taxedBooking as never),
);
check(
  "Neha outstandingTurfDues == 0 (fully paid, gross)",
  neha!.outstandingTurfDues,
  0,
);

/* -------------------- 12. Balance moved to dues (no double count, Oct) */

section("12. Balance moved to dues — every rupee reachable once");
// Oct booking: ₹1000 turf, ₹400 taken at the counter, the ₹600 balance moved
// onto Ravi's running tab ("Put balance on tab"). That write sets
// advance_paid to the full ₹1000, so anything reading advance_paid at face
// value would count ₹1000 here AND ₹600 again when the tab is collected.
const OCT = "2026-10";
const octBooking = {
  id: "k9",
  booking_no: "B-9",
  booking_date: "2026-10-05",
  customer_name: "Ravi",
  phone: "9876543210",
  slot_name: "Evening",
  hours: 1,
  rate_per_hour: 1000,
  total_amount: 1000,
  advance_paid: 1000, // inflated by the move — never a cash figure
  payment_mode: "Cash",
  status: "Confirmed",
  discount: 0,
  merged_into_bill_id: null,
} as AnyRec;
// Snack sale billed "On tab": ₹300, no cash at the counter.
const octSale = {
  id: "s9",
  bill_no: "S-9",
  sale_date: "2026-10-05",
  customer_name: "Ravi",
  items: [],
  total: 300,
  profit: 100,
  payment_mode: "On tab",
  merged_into_bill_id: null,
} as AnyRec;
const tabCharge = (
  id: string,
  refType: string,
  refId: string,
  amount: number,
) =>
  ({
    id,
    tab_id: "t9",
    customer_key: "p:9876543210",
    kind: "charge",
    business: "Shared",
    amount,
    ref_type: refType,
    ref_id: refId,
    entry_date: "2026-10-05",
    created_at: "2026-10-05T04:00:00.000Z",
  }) as AnyRec;
// A real Dues-tab collection: a payment row with NO ref_type (a ref_type on a
// payment marks a bookkeeping reversal, where no cash moved).
const duesPayment = (id: string, amount: number, mode: string) =>
  ({
    id,
    tab_id: "t9",
    customer_key: "p:9876543210",
    kind: "payment",
    business: "Shared",
    amount,
    ref_type: null,
    ref_id: null,
    payment_mode: mode,
    entry_date: "2026-10-06",
    created_at: "2026-10-06T04:00:00.000Z",
  }) as AnyRec;

const octEntriesOpen = [
  tabCharge("t-a", "turf_booking", "k9", 600),
  tabCharge("t-b", "snack_sale", "s9", 300),
];
const srcOctOpen = {
  bills: [],
  bookings: [octBooking],
  sales: [octSale],
  expenses: [],
  tabEntries: octEntriesOpen,
};
const srcOctPaid = {
  ...srcOctOpen,
  tabEntries: [...octEntriesOpen, duesPayment("t-c", 900, "UPI")],
};

const octOpen = statsForMonth(srcOctOpen as never, OCT, DEFAULT_APP_SETTINGS);
check(
  "cash taken on the booking (not advance_paid)",
  bookingCashCollected(octBooking as never, octEntriesOpen as never),
  400,
);
check(
  "booking flagged as moved to dues",
  bookingMovedToDues(octBooking as never, octEntriesOpen as never),
  true,
);
check(
  "snack sale flagged as moved to dues",
  saleMovedToDues(octSale as never, octEntriesOpen as never),
  true,
);
check(
  "booking owes nothing of its own",
  bookingDue(octBooking as never, octEntriesOpen as never),
  0,
);
check("Oct collected while dues are open", octOpen.collected, 400);
check("Oct revenue (turf + snacks, pre-tax)", octOpen.netRevenue, 1300);
const splitOpen = paymentSplit(
  srcOctOpen as never,
  (iso: string) => monthKey(iso) === OCT,
);
check(
  "Oct split total while dues are open",
  splitOpen.reduce((n, r) => n + r.value, 0),
  400,
);
check(
  "Oct split has no 'On tab' bucket",
  splitOpen.some((r) => r.name === "Other"),
  false,
);

const octPaid = statsForMonth(srcOctPaid as never, OCT, DEFAULT_APP_SETTINGS);
check("Oct tabCollected after settling dues", octPaid.tabCollected, 900);
check(
  "Oct collected after settling (400 + 900, never 1900)",
  octPaid.collected,
  1300,
);
check(
  "Oct collected reconciles with revenue",
  octPaid.collected,
  octPaid.netRevenue,
);
const splitPaid = paymentSplit(
  srcOctPaid as never,
  (iso: string) => monthKey(iso) === OCT,
);
check(
  "Oct split total after settling",
  splitPaid.reduce((n, r) => n + r.value, 0),
  1300,
);
check(
  "Oct split Cash leg (counter only)",
  splitPaid.find((r) => r.name === "Cash")?.value ?? 0,
  400,
);
check(
  "Oct split UPI leg (dues collection)",
  splitPaid.find((r) => r.name === "UPI")?.value ?? 0,
  900,
);

/* ---------------------------------------------------------------- done */

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} — Jul revenue ${jul.revenue.toFixed(2)}, Aug revenue ${aug.revenue.toFixed(2)}, combined ${both.revenue.toFixed(2)}\n`,
);
process.exit(failures === 0 ? 0 : 1);
