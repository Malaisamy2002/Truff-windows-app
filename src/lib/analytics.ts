import { rupees } from "./money";
import type { Bill } from "@/lib/biz";
import type { ExpenseV2, SnackSale, TurfBooking } from "@/lib/ops";
import {
  readAppSettings,
  taxBreakdown,
  type AppSettings,
} from "@/lib/settings";
import { TAB_PAYMENT_MODE } from "@/lib/ops";
import type { TabEntry } from "@/lib/tabs";
import { TAB_REF_BILL } from "@/lib/tabs";
import {
  bookingCashCollected,
  bookingDue,
  isFinancialBooking,
  isFinancialSale,
  isTabCashPayment,
  netTabAmountFor,
  snackSaleCollected,
} from "@/lib/dues";

import {
  bookingGrossTotal,
  bookingTaxable,
  snackSaleGrossTotal,
  type TaxSnapshot,
} from "@/lib/biz";

// Plain "YYYY-MM-DD" strings (booking_date, sale_date, spent_at) are sliced
// instead of parsed: Date construction per row is the single biggest cost
// once a year holds tens of thousands of records. bill_date, however, is
// stored as a FULL UTC timestamp (new Date().toISOString()) — that also
// starts with 10 digits matching this shape, but slicing it reads off the
// UTC calendar date, not the IST one. Only take the slice fast-path for
// strings that are exactly a plain date with no time component; anything
// longer is bucketed by explicit IST (UTC+5:30) arithmetic below.
//
// IMPORTANT: this used to read the bill_date's calendar day/month via
// `x.getFullYear()`/`getMonth()`/`getDate()` — but those are the JS
// runtime's LOCAL timezone, not IST specifically. That's the same class of
// bug this file exists to prevent: it silently gave the right answer only
// because the app happens to run on devices already set to IST, and
// silently gave the WRONG answer the moment it ran anywhere else (a CI
// runner, a differently-configured device, a browser with its clock set
// wrong) — a bill made in the last ~5.5 hours of the UTC day would land in
// the wrong month/day exactly like the bug this comment used to warn
// against, just one layer further out. IST has no daylight-saving shifts,
// so a fixed +5:30 offset applied to the UTC instant — then read back with
// UTC getters — gives the correct IST calendar date regardless of what
// timezone the code happens to be executing in.
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The IST (UTC+5:30) calendar instant for a given absolute time — read its
 * UTC getters afterwards for a runtime-timezone-independent IST date. */
const toIst = (x: Date) => new Date(x.getTime() + IST_OFFSET_MS);

export const monthKey = (d: string | Date) => {
  if (typeof d === "string" && PLAIN_DATE.test(d)) return d.slice(0, 7);
  const x = toIst(typeof d === "string" ? new Date(d) : d);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const monthLabel = (key: string) =>
  new Date(`${key}-01T00:00:00`).toLocaleDateString("en-IN", {
    month: "short",
    year: "2-digit",
  });

export const dayKey = (d: string | Date) => {
  if (typeof d === "string" && PLAIN_DATE.test(d)) return d;
  const x = toIst(typeof d === "string" ? new Date(d) : d);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(
    x.getUTCDate(),
  ).padStart(2, "0")}`;
};

// prevMonthKey/lastMonthKeys only ever do arithmetic on a "YYYY-MM" key
// they were themselves given (never a raw timestamp), so — like the plain
// booking_date/sale_date fast-path above — there's no instant-in-time to
// misinterpret. Still, the previous version routed through
// `new Date(y, m, 1)` (local-component constructor) before re-parsing with
// monthKey(), which made the result depend on the runtime's local
// timezone for no reason. Date.UTC() sidesteps that: pure calendar
// arithmetic on the key's own numbers, independent of wherever this runs.
export const prevMonthKey = (key: string) => {
  const [y = 0, m = 1] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1)); // m is 1-indexed; -2 = previous month, 0-indexed
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const lastMonthKeys = (key: string, count: number) => {
  const [y = 0, m = 1] = key.split("-").map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }
  return keys;
};

/**
 * Every "YYYY-MM" month key from `startKey` to `endKey` inclusive, in order.
 * Unlike `lastMonthKeys` (a fixed trailing window ending at a given month),
 * this spans an arbitrary range — the building block for the Reports "All
 * time" / custom-range export (#7), which needs to cover however many years
 * of data actually exist rather than a hardcoded 6-month/1-month window.
 * Same `Date.UTC` pure-calendar-arithmetic approach as `lastMonthKeys`, so
 * it's independent of the runtime's local timezone. If `endKey` is before
 * `startKey` (e.g. there's no data at all), returns an empty array rather
 * than counting backwards.
 */
export const monthsBetween = (startKey: string, endKey: string): string[] => {
  const [sy = 0, sm = 1] = startKey.split("-").map(Number);
  const [ey = 0, em = 1] = endKey.split("-").map(Number);
  const totalMonths = (ey - sy) * 12 + (em - sm);
  if (totalMonths < 0) return [];
  const keys: string[] = [];
  for (let i = 0; i <= totalMonths; i++) {
    const d = new Date(Date.UTC(sy, sm - 1 + i, 1));
    keys.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }
  return keys;
};

/**
 * The earliest and latest "YYYY-MM-DD" activity date across every source
 * table, read off whichever date field each row uses (`bill_date` is a full
 * ISO timestamp; `booking_date`/`sale_date`/`spent_at` are plain dates —
 * `dayKey()` normalizes either to a plain IST calendar date the same way
 * the rest of this file does). Returns `null` when there's no data at all
 * (nothing to export). This is how the "All time" export determines its
 * actual range instead of assuming any fixed window.
 */
export const dataDateRange = (
  src: Sources,
): { earliest: string; latest: string } | null => {
  let earliest: string | null = null;
  let latest: string | null = null;
  const consider = (iso: string | null | undefined) => {
    if (!iso) return;
    const key = dayKey(iso);
    if (earliest === null || key < earliest) earliest = key;
    if (latest === null || key > latest) latest = key;
  };
  for (const b of src.bills) consider(b.bill_date);
  for (const b of src.bookings) consider(b.booking_date);
  for (const s of src.sales) consider(s.sale_date);
  for (const e of src.expenses) consider(e.spent_at);
  if (earliest === null || latest === null) return null;
  return { earliest, latest };
};

const num = (v: unknown) => Number(v) || 0;

// `isFinancialBooking` now lives in lib/dues.ts alongside the rest of the
// money rules (it is re-exported below so existing imports from
// "@/lib/analytics" keep working, and the dependency stays one-directional).
export { isFinancialBooking } from "./dues";

export type Sources = {
  bills: Bill[];
  bookings: TurfBooking[];
  sales: SnackSale[];
  expenses: ExpenseV2[];
  /**
   * The tab ledger. Optional so old call sites still compile, but WITHOUT it
   * an amount the operator moved onto a customer's running tab is counted
   * both here and in the Dues tab. Pass it wherever dues are shown.
   */
  tabEntries?: TabEntry[];
};

export type PeriodStats = {
  billsRevenue: number;
  /** Part of `collected` attributable to bills alone (excludes bookings/
   * sales/tab payments) — a cancelled bill contributes 0, same as
   * `billsRevenue`. */
  billsCollected: number;
  /** Part of `dues` attributable to bills alone (excludes booking dues) — a
   * cancelled bill contributes 0, same as `billsRevenue`. */
  billsDues: number;
  turfRevenue: number;
  snacksRevenue: number;
  /** Total tax added on top of bills this period — shown as its own
   * dashboard figure rather than folded silently into revenue. */
  tax: number;
  /** Gross revenue including tax — the headline figure now that tax is
   * added on top of bills rather than hidden inside a net total. */
  revenue: number;
  /** Revenue before tax — bills + turf + snacks with no tax added. Use this
   * (alongside `tax`) wherever tax should be broken out instead of folded
   * into a single combined figure. */
  netRevenue: number;
  collected: number;
  /** Part of `collected` that arrived as payments against running tabs
   * (customer paid down their tab) rather than on a bill/booking/sale. */
  tabCollected: number;
  expenses: number;
  profit: number;
  dues: number;
  snackProfit: number;
};

/** Aggregate every business line for one period (matched by a key function). */
export function periodStats(
  src: Sources,
  matches: (iso: string) => boolean,
  appSettings: AppSettings = readAppSettings(),
): PeriodStats {
  const bills = src.bills.filter((b) => matches(b.bill_date));
  const bookings = src.bookings.filter(
    (b) => matches(b.booking_date) && isFinancialBooking(b),
  );
  const entries = src.tabEntries ?? [];
  // Sales rolled into a merged bill are no longer their own financial record:
  // their revenue is on the bill (see lib/dues.ts / isFinancialSale).
  const sales = src.sales.filter(
    (s) => matches(s.sale_date) && isFinancialSale(s),
  );
  const expenses = src.expenses.filter((e) => matches(e.spent_at));

  // Bills carry tax (GST + any custom taxes) and so do turf bookings/snack
  // sales wherever GST is switched on — receipts, the Turf tab and the Dues
  // tab (dues.ts's bookingDue/bookingGrossTotal) already treat that tax as
  // real, collected money. Each bill's tax is the figure FROZEN on the bill
  // when it was created (`tax_amount`) — the same number its receipt printed
  // and the Bills tab collects — never today's rate re-applied backwards.
  // Only legacy rows saved before the snapshot existed fall back to the
  // supplied settings (mirrors biz.ts's grossWithTax()).
  let billsRevenue = 0;
  let billsTax = 0;
  let billsCollected = 0;
  let billsDues = 0;
  for (const b of bills) {
    // A cancelled bill is a void record, not revenue, not a due, and not
    // tax collected — see BillStatus in biz.ts. Skip it entirely rather
    // than letting its stored total/amount_paid leak into any of the
    // sums below.
    if (b.status === "cancelled") continue;
    // Whole-rupee taxable amount, exactly as billGrossTotal()/the receipt use it.
    const net = rupees(b.total);
    const taxAmount =
      typeof b.tax_amount === "number"
        ? rupees(b.tax_amount)
        : taxBreakdown(net, appSettings).taxAmount;
    const gross = net + taxAmount;
    const onTabBill = (b.payment_mode ?? "") === TAB_PAYMENT_MODE;
    // An "On tab" bill only ever collected what its sources collected; the
    // remainder is a tab charge, so it is not revenue received here.
    const paid = onTabBill
      ? Math.max(0, rupees(b.amount_paid))
      : b.status === "paid"
        ? gross
        : rupees(b.amount_paid);
    // Anything the tab ledger owns for this bill is owed on the Dues tab, not
    // here — counting both would double the same rupee. Same rule as
    // dues.ts's billDue(): an "On tab" bill owes nothing of its own.
    const onTab = onTabBill
      ? gross - paid
      : netTabAmountFor(entries, TAB_REF_BILL, b.id);
    billsRevenue += net;
    billsTax += taxAmount;
    billsCollected += paid;
    billsDues += Math.max(0, gross - paid - onTab);
  }

  const turfRevenue = bookings.reduce((n, b) => n + rupees(b.total_amount), 0);
  const snacksRevenue = sales.reduce((n, s) => n + rupees(s.total), 0);
  // Each booking/sale's own frozen tax snapshot — same figure its receipt
  // printed (bookingGrossTotal/snackSaleGrossTotal) minus its pre-tax total.
  // Without this, collected (which is tax-inclusive) drifts away from
  // revenue + tax by exactly the GST charged on taxed bookings/sales.
  const bookingsTax = bookings.reduce(
    (n, b) =>
      n +
      Math.max(0, bookingGrossTotal(b, appSettings) - rupees(b.total_amount)),
    0,
  );
  const snacksTax = sales.reduce(
    (n, s) =>
      n + Math.max(0, snackSaleGrossTotal(s, appSettings) - rupees(s.total)),
    0,
  );
  // Money the customer actually handed over against a running tab in this
  // period. A charge moved onto the tab left `collected` on its source
  // record (bookings/bills/"On tab" sales collect nothing for it), so the
  // cash arrives here — exactly once — when the tab is paid down.
  const tabCollected = entries
    .filter((e) => isTabCashPayment(e) && matches(e.entry_date))
    .reduce((n, e) => n + rupees(e.amount), 0);
  const collected =
    billsCollected +
    // NOT advance_paid: "Put balance on tab" inflates it to the full gross
    // while the remainder is a tab charge, which would be counted again as
    // tabCollected once the tab is paid. bookingCashCollected strips that out.
    bookings.reduce((n, b) => n + bookingCashCollected(b, entries), 0) +
    sales.reduce((n, s) => n + snackSaleCollected(s, appSettings), 0) +
    tabCollected;
  const spend = expenses.reduce((n, e) => n + rupees(e.amount), 0);
  const dues =
    billsDues +
    bookings.reduce((n, b) => n + bookingDue(b, entries, appSettings), 0);

  // Tax collected is money passed through to the government, not the
  // business's own earnings — profit is based on net (pre-tax) revenue so
  // switching a tax on doesn't inflate reported profit.
  const netRevenue = billsRevenue + turfRevenue + snacksRevenue;
  const tax = billsTax + bookingsTax + snacksTax;
  const revenue = netRevenue + tax;
  return {
    billsRevenue,
    billsCollected,
    billsDues,
    turfRevenue,
    snacksRevenue,
    tax,
    revenue,
    netRevenue,
    collected,
    tabCollected,
    expenses: spend,
    profit: netRevenue - spend,
    dues,
    snackProfit: sales.reduce((n, s) => n + rupees(s.profit), 0),
  };
}

export const statsForMonth = (
  src: Sources,
  key: string,
  appSettings?: AppSettings,
) => periodStats(src, (iso) => monthKey(iso) === key, appSettings);

export const statsForDay = (src: Sources, key: string) =>
  periodStats(src, (iso) => dayKey(iso) === key);

/** Percent change vs a previous value; null when there is no comparable base. */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export const PAY_MODE_ORDER = [
  "Cash",
  "UPI",
  "Card",
  "Pending",
  "Other",
] as const;

const normalizeMode = (mode: string | null | undefined) => {
  const m = (mode ?? "").trim().toLowerCase();
  if (m === "cash") return "Cash";
  if (m === "upi") return "UPI";
  if (m === "card") return "Card";
  if (m === "pending" || m === "") return "Pending";
  return "Other";
};

/** Money actually received in the period, split by how it was paid. */
export function paymentSplit(src: Sources, matches: (iso: string) => boolean) {
  const totals = new Map<string, number>();
  const add = (mode: string | null | undefined, amount: number) => {
    if (amount <= 0) return;
    // "On tab" is not a payment method — nothing was received yet. The money
    // shows up here later, under Cash/UPI, when the tab is collected.
    if ((mode ?? "") === TAB_PAYMENT_MODE) return;
    const key = normalizeMode(mode);
    totals.set(key, (totals.get(key) ?? 0) + amount);
  };

  for (const b of src.bills.filter(
    (x) => matches(x.bill_date) && x.status !== "cancelled",
  ))
    add(b.payment_mode, rupees(b.amount_paid));
  for (const b of src.bookings.filter(
    (x) => matches(x.booking_date) && isFinancialBooking(x),
  ))
    // Same rule as periodStats: a balance moved onto the tab was never
    // received under this booking's payment mode.
    add(b.payment_mode, bookingCashCollected(b, src.tabEntries ?? []));

  for (const s of src.sales.filter(
    (x) => matches(x.sale_date) && isFinancialSale(x),
  ))
    add(s.payment_mode, snackSaleCollected(s));
  // Cash that arrived as a payment against a running tab (see periodStats).
  for (const e of (src.tabEntries ?? []).filter(
    (x) => isTabCashPayment(x) && matches(x.entry_date),
  ))
    add(e.payment_mode ?? "Cash", rupees(e.amount));

  return PAY_MODE_ORDER.filter((m) => (totals.get(m) ?? 0) > 0).map((m) => ({
    name: m,
    value: totals.get(m) ?? 0,
  }));
}

/** Expense totals by category for a period. */
export function expenseByCategory(
  src: Sources,
  matches: (iso: string) => boolean,
) {
  const map = new Map<string, number>();
  for (const e of src.expenses.filter((x) => matches(x.spent_at))) {
    const key = e.category || "Other";
    map.set(key, (map.get(key) ?? 0) + rupees(e.amount));
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

/** Month-by-month profit & loss rows, oldest first. */
export function profitAndLoss(src: Sources, keys: string[]) {
  return keys.map((k) => {
    const s = statsForMonth(src, k);
    return {
      key: k,
      month: monthLabel(k),
      Revenue: s.revenue,
      NetRevenue: s.netRevenue,
      Tax: s.tax,
      Expenses: s.expenses,
      Profit: s.profit,
      Turf: s.turfRevenue,
      Snacks: s.snacksRevenue,
      Bills: s.billsRevenue,
      Collected: s.collected,
      Dues: s.dues,
    };
  });
}

/**
 * GST-ready tax rows, oldest first: taxable value (net revenue across
 * Bills, turf bookings and snack sales — pre-tax), each rate slab broken
 * out (CGST/SGST for GST, one line per custom tax) and the total tax
 * collected that month, for GST filing.
 *
 * Every figure is the tax ACTUALLY CHARGED: `totalTax` is the sum of each
 * record's own frozen tax (bills, taxed bookings, taxed snack sales — see
 * periodStats) and `lines` sums each record's frozen `tax_lines` by label
 * across bills, bookings and sales alike. Nothing here re-applies today's
 * rate backwards. Legacy rows saved before tax snapshots existed (no
 * `tax_lines`) are the one exception: their tax is recomputed from the
 * supplied settings, exactly as their receipt reprint does.
 */
export function taxReport(
  src: Sources,
  keys: string[],
  appSettings: AppSettings = readAppSettings(),
) {
  return keys.map((k) => {
    const s = statsForMonth(src, k, appSettings);
    const inMonth = (iso: string) => monthKey(iso) === k;
    const byLabel = new Map<string, number>();
    const addLines = (taxable: number, rec: TaxSnapshot) => {
      const lines = rec.tax_lines
        ? rec.tax_lines
        : typeof rec.tax_amount === "number"
          ? []
          : taxBreakdown(rupees(taxable), appSettings).lines;
      for (const l of lines)
        byLabel.set(l.label, (byLabel.get(l.label) ?? 0) + rupees(l.value));
    };
    for (const b of src.bills)
      if (inMonth(b.bill_date) && b.status !== "cancelled")
        addLines(b.total, b);
    for (const b of src.bookings)
      if (inMonth(b.booking_date) && isFinancialBooking(b))
        addLines(bookingTaxable(b), b);
    for (const x of src.sales)
      if (inMonth(x.sale_date) && isFinancialSale(x)) addLines(x.total, x);
    const lines = [...byLabel.entries()].map(([label, value]) => ({
      label,
      value,
    }));
    const taxableValue = s.netRevenue; // billsRevenue + turfRevenue + snacksRevenue
    const totalTax = s.tax; // billsTax + bookingsTax + snacksTax (each frozen)
    return {
      key: k,
      month: monthLabel(k),
      taxableValue,
      lines,
      totalTax,
      grossValue: taxableValue + totalTax,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Dues ageing                                                         */
/* ------------------------------------------------------------------ */

export type AgeBucket = "overdue" | "month" | "week" | "today";

export const AGE_BUCKET_META: Record<AgeBucket, string> = {
  overdue: "30+ days overdue",
  month: "This month",
  week: "This week",
  today: "Today",
};

/** Overdue-first order so the oldest money owed surfaces at the top. */
export const AGE_BUCKET_ORDER: AgeBucket[] = [
  "overdue",
  "month",
  "week",
  "today",
];

export function ageBucket(
  dateIso: string,
  now: number = Date.now(),
): AgeBucket {
  const ageDays = Math.floor((now - new Date(dateIso).getTime()) / 86_400_000);
  if (ageDays >= 30) return "overdue";
  if (ageDays >= 7) return "month";
  if (ageDays >= 1) return "week";
  return "today";
}

export type DuesAgeingRow = {
  bucket: AgeBucket;
  label: string;
  count: number;
  amount: number;
};

/**
 * Every outstanding turf due (across all loaded bookings, not just the
 * selected report month — dues don't reset month to month) grouped by how
 * overdue it is, overdue-first. Shares `isFinancialBooking` with the rest of
 * this file so a cancelled or merged booking never shows up as owed here
 * either.
 */
export function duesAgeing(
  bookings: TurfBooking[],
  now: number = Date.now(),
  tabEntries: TabEntry[] = [],
): DuesAgeingRow[] {
  const totals = new Map<AgeBucket, { count: number; amount: number }>();
  for (const b of bookings) {
    if (!isFinancialBooking(b)) continue;
    // The one shared "still owed" figure (tax-inclusive, tab-aware) — the
    // same rupee the Turf tab, Dues tab and Dashboard show for this booking.
    const due = bookingDue(b, tabEntries);
    if (due <= 0) continue;
    const bucket = ageBucket(b.booking_date, now);
    const prev = totals.get(bucket) ?? { count: 0, amount: 0 };
    prev.count += 1;
    prev.amount += due;
    totals.set(bucket, prev);
  }
  return AGE_BUCKET_ORDER.map((bucket) => ({
    bucket,
    label: AGE_BUCKET_META[bucket],
    count: totals.get(bucket)?.count ?? 0,
    amount: Math.round(totals.get(bucket)?.amount ?? 0),
  }));
}

/* ------------------------------------------------------------------ */
/* Turf occupancy                                                      */
/* ------------------------------------------------------------------ */

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday-first weekday index for a plain "YYYY-MM-DD" date. */
const weekdayIndex = (dateStr: string) =>
  (new Date(`${dateStr}T00:00:00`).getDay() + 6) % 7;

/** "18:30" / "6:30 PM" → minutes past midnight; null when unparseable. */
export function clockMinutes(value: string | null | undefined): number | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const mins = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!Number.isFinite(h) || h > 24 || mins > 59) return null;
  return h * 60 + mins;
}

export type OccupancyRow = {
  key: string;
  label: string;
  bookings: number;
  hours: number;
  revenue: number;
  /** Share of the period's total booked hours, 0–100. */
  sharePct: number;
};

export type TurfOccupancy = {
  byWeekday: OccupancyRow[];
  byHour: OccupancyRow[];
  bookingCount: number;
  bookedHours: number;
  revenue: number;
  avgSlotValue: number;
  avgSlotHours: number;
  cancelled: { count: number; amount: number };
  unpaid: { count: number; amount: number };
  busiestWeekday: OccupancyRow | null;
  busiestHour: OccupancyRow | null;
};

/**
 * Turf usage detail for one period: how full each weekday and each hour of
 * the day ran, what an average slot was worth, and how much was lost to
 * cancelled or still-unpaid slots. Shares the same `matches(iso)` convention
 * as `periodStats`, so the Reports screen and the exports read one number.
 */
export function turfOccupancy(
  bookings: TurfBooking[],
  matches: (iso: string) => boolean,
  tabEntries: TabEntry[] = [],
): TurfOccupancy {
  const period = bookings.filter((b) => matches(b.booking_date));
  const financial = period.filter((b) => isFinancialBooking(b));

  const weekdayAgg = WEEKDAY_LABELS.map(() => ({
    bookings: 0,
    hours: 0,
    revenue: 0,
  }));
  const hourAgg = Array.from({ length: 24 }, () => ({
    bookings: 0,
    hours: 0,
    revenue: 0,
  }));

  let bookedHours = 0;
  let revenue = 0;

  for (const b of financial) {
    const amount = num(b.total_amount);
    const start = clockMinutes(b.start_time);
    let end = clockMinutes(b.end_time);
    if (start !== null && end !== null && end <= start) end += 1440;
    const spanHours =
      start !== null && end !== null
        ? (end - start) / 60
        : Math.max(0, num(b.hours));
    const hours = spanHours > 0 ? spanHours : Math.max(0, num(b.hours));

    revenue += amount;
    bookedHours += hours;

    const wd = weekdayAgg[weekdayIndex(b.booking_date)];
    if (wd) {
      wd.bookings += 1;
      wd.hours += hours;
      wd.revenue += amount;
    }

    if (start !== null && end !== null && end > start) {
      for (let m = start; m < end; m += 60) {
        const slice = Math.min(60, end - m) / 60;
        const cell = hourAgg[Math.floor(m / 60) % 24];
        if (!cell) continue;
        cell.hours += slice;
        cell.revenue += hours > 0 ? (amount * slice) / hours : 0;
        if (m === start) cell.bookings += 1;
      }
    }
  }

  const row = (
    key: string,
    label: string,
    agg: { bookings: number; hours: number; revenue: number },
  ): OccupancyRow => ({
    key,
    label,
    bookings: agg.bookings,
    hours: Math.round(agg.hours * 100) / 100,
    revenue: Math.round(agg.revenue),
    sharePct: bookedHours > 0 ? (agg.hours / bookedHours) * 100 : 0,
  });

  const byWeekday = WEEKDAY_LABELS.map((label, i) =>
    row(`wd-${i}`, label, weekdayAgg[i]!),
  );
  const byHour = hourAgg.map((agg, h) =>
    row(`hr-${h}`, `${String(h).padStart(2, "0")}:00`, agg),
  );

  const cancelledRows = period.filter((b) => b.status === "Cancelled");
  // "Unpaid" = the shared tax-inclusive, tab-aware bookingDue() — the same
  // figure the Turf/Dues tabs show, not a pre-tax total minus advance.
  const unpaidRows = financial.filter((b) => bookingDue(b, tabEntries) > 0);

  const pick = (rows: OccupancyRow[]) => {
    const best = rows.reduce<OccupancyRow | null>(
      (a, b) => (a === null || b.hours > a.hours ? b : a),
      null,
    );
    return best && best.hours > 0 ? best : null;
  };

  return {
    byWeekday,
    byHour,
    bookingCount: financial.length,
    bookedHours: Math.round(bookedHours * 100) / 100,
    revenue: Math.round(revenue),
    avgSlotValue:
      financial.length > 0 ? Math.round(revenue / financial.length) : 0,
    avgSlotHours:
      financial.length > 0
        ? Math.round((bookedHours / financial.length) * 100) / 100
        : 0,
    cancelled: {
      count: cancelledRows.length,
      amount: Math.round(
        cancelledRows.reduce((n, b) => n + num(b.total_amount), 0),
      ),
    },
    unpaid: {
      count: unpaidRows.length,
      amount: Math.round(
        unpaidRows.reduce((n, b) => n + bookingDue(b, tabEntries), 0),
      ),
    },
    busiestWeekday: pick(byWeekday),
    busiestHour: pick(byHour),
  };
}

/* ------------------------------------------------------------------ */
/* Item performance                                                    */
/* ------------------------------------------------------------------ */

export type ItemPerformanceRow = {
  name: string;
  qty: number;
  revenue: number;
  profit: number;
  /** Profit as a percentage of revenue, 0 when the item made no revenue. */
  marginPct: number;
};

export type ItemPerformance = {
  rows: ItemPerformanceRow[];
  topByRevenue: ItemPerformanceRow[];
  topByProfit: ItemPerformanceRow[];
  /** Items that did sell, ranked from the weakest revenue upwards. */
  slowMovers: ItemPerformanceRow[];
};

/** Best sellers, best earners and slow movers for one period. */
export function itemPerformance(
  sales: SnackSale[],
  matches: (iso: string) => boolean,
  limit = 5,
): ItemPerformance {
  const map = new Map<string, ItemPerformanceRow>();
  for (const s of sales) {
    if (!matches(s.sale_date) || !isFinancialSale(s)) continue;
    for (const it of s.items ?? []) {
      const name = (it.item_name || "Item").trim();
      const prev = map.get(name) ?? {
        name,
        qty: 0,
        revenue: 0,
        profit: 0,
        marginPct: 0,
      };
      const qty = num(it.qty);
      const amount = num(it.amount);
      prev.qty += qty;
      prev.revenue += amount;
      prev.profit += amount - qty * num(it.cost_price);
      map.set(name, prev);
    }
  }

  const rows = [...map.values()].map((r) => ({
    ...r,
    revenue: Math.round(r.revenue),
    profit: Math.round(r.profit),
    marginPct: r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0,
  }));

  const byRevenue = [...rows].sort((a, b) => b.revenue - a.revenue);
  return {
    rows: byRevenue,
    topByRevenue: byRevenue.slice(0, limit),
    topByProfit: [...rows].sort((a, b) => b.profit - a.profit).slice(0, limit),
    slowMovers: [...rows].sort((a, b) => a.revenue - b.revenue).slice(0, limit),
  };
}

/* ------------------------------------------------------------------ */
/* Customer ranking                                                    */
/* ------------------------------------------------------------------ */

/** Structural shape of `customerLifetimeStats()` rows — declared here rather
 *  than imported so analytics stays free of a dependency on lib/data. */
export type RankableCustomer = {
  id: string;
  name: string;
  phone: string | null;
  bookingsCount: number;
  totalSpend: number;
  avgBookingValue: number;
  outstandingTurfDues: number;
  /** Everything still owed (turf + bills + running tab). Ranking prefers
   * this when present so a customer whose balance sits on their tab still
   * shows up under "who still owes". */
  outstandingTotal?: number;
  lastActivity?: string | null;
};

/** The figure "who still owes" ranks by: total owed when known, else turf dues. */
export const owedBy = (c: RankableCustomer) =>
  c.outstandingTotal ?? c.outstandingTurfDues;

export type CustomerRanking<T extends RankableCustomer> = {
  topSpenders: T[];
  mostFrequent: T[];
  owing: T[];
};

/** Who spends most, who comes most often, and who still owes. */
export function customerRanking<T extends RankableCustomer>(
  stats: T[],
  limit = 5,
): CustomerRanking<T> {
  const active = stats.filter((c) => c.totalSpend > 0 || c.bookingsCount > 0);
  return {
    topSpenders: [...active]
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, limit),
    mostFrequent: [...active]
      .sort((a, b) => b.bookingsCount - a.bookingsCount)
      .slice(0, limit),
    owing: stats
      .filter((c) => owedBy(c) > 0)
      .sort((a, b) => owedBy(b) - owedBy(a))
      .slice(0, limit),
  };
}
