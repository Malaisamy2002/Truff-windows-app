/**
 * The ONE source of truth for "what is still owed".
 *
 * A rupee of due can live in exactly one of three places:
 *   1. a turf booking's unpaid balance (Turf tab),
 *   2. a bill's unpaid balance (Bills tab / merged bills),
 *   3. the customer's running tab ledger (Dues tab).
 *
 * Whenever an operator moves a due (turf "Put balance on tab", a snack bill
 * paid "On tab", or a merged bill) the ledger gets a charge and this module
 * subtracts that exact amount from the source record — so Turf, Snacks, Dues,
 * Bills, Customers and Reports can never disagree, and no rupee is counted
 * twice.
 */

import {
  balanceOf,
  billGrossTotal,
  bookingGrossTotal,
  bookingTaxable,
  snackSaleGrossTotal,
  type Bill,
  type TaxSnapshot,
} from "./biz";
import { rupees } from "./money";
import { TAB_PAYMENT_MODE, type SnackSale, type TurfBooking } from "./ops";

import {
  TAB_REF_BILL,
  TAB_REF_MERGE_REVERSE,
  TAB_REF_SNACK_SALE,
  TAB_REF_TURF_BOOKING,
  tabKey,
  type TabEntry,
} from "./tabs";

const num = (v: unknown) => Number(v) || 0;
/** Every due is a whole rupee — see lib/money.ts for the single rule. */
const round2 = rupees;

/**
 * Net amount still sitting on a tab for one source record: charges made
 * against it minus any payments/reversals recorded against the same ref.
 * Never negative — an over-collection belongs to the tab, not to the record.
 */
export function netTabAmountFor(
  entries: TabEntry[],
  refType: string,
  refId: string | null | undefined,
) {
  if (!refId) return 0;
  let net = 0;
  for (const e of entries) {
    if (e.ref_type !== refType || e.ref_id !== refId) continue;
    net += e.kind === "charge" ? num(e.amount) : -num(e.amount);
  }
  return Math.max(0, round2(net));
}

/**
 * True for a ledger row that is REAL money handed over against a running
 * tab (a payment recorded from the Dues tab / customer card / final
 * settlement). Bookkeeping reversals — a merge pulling a source charge off
 * the tab, an un-merge putting it back — are also stored as `payment` rows
 * but carry a `ref_type`, and no cash changed hands for them.
 */
export const isTabCashPayment = (e: Pick<TabEntry, "kind" | "ref_type">) =>
  e.kind === "payment" && !e.ref_type;

/**
 * The ONE place that decides whether a turf booking is still its own
 * financial record: not Cancelled, not No-show, and not merged into a bill
 * (a merged booking's money lives on that bill). Every revenue/dues/advance
 * sum in the app must filter through this instead of re-writing the clauses
 * inline.
 *
 * No-show was added to this exclusion (previously only Cancelled was
 * excluded — see ops.ts BOOKING_STATUSES history): a slot marked No-show was
 * never delivered, so it shouldn't count as earned revenue, and an unpaid
 * balance on it isn't a debt anyone is expected to come back and settle. A
 * business that wants to charge a no-show fee would need that as an
 * explicit, separate line item — not by leaving the full booking amount
 * sitting as an outstanding due indefinitely.
 *
 * Do NOT use it for non-money booking counts (e.g. "visits") — a merged or
 * no-show booking still happened as an event.
 */
export const isFinancialBooking = (
  b: Pick<TurfBooking, "status" | "merged_into_bill_id">,
) =>
  b.status !== "Cancelled" && b.status !== "No-show" && !b.merged_into_bill_id;

/**
 * Snack sales rolled into a merged bill stay in the database (their tab
 * charges must keep a traceable parent) but stop being their own financial
 * record — mirror of `isFinancialBooking` for sales.
 *
 * A voided sale (`cancelled`, via `useVoidSnackSale`) is excluded the same
 * way — the items went back to stock and were never actually kept by the
 * customer, so it's not revenue and not a due, same reasoning Step 27 used
 * to add `"No-show"` to `isFinancialBooking` above.
 */
export const isFinancialSale = (
  s: Pick<SnackSale, "merged_into_bill_id" | "cancelled">,
) => !s.merged_into_bill_id && !s.cancelled;

/** Structural shape `bookingDue` needs — narrower than the full `TurfBooking`
 * so callers with a partial/projected booking (e.g. `customerLifetimeStats`
 * in data.ts) can still route through the one shared "what's still owed"
 * formula instead of re-deriving it by hand. Mirrors the same pattern
 * `bookingTaxable`/`isFinancialBooking` already use. */
export type DueBooking = Pick<TurfBooking, "id" | "status" | "advance_paid"> &
  Partial<Pick<TurfBooking, "merged_into_bill_id">> &
  Parameters<typeof bookingTaxable>[0] &
  TaxSnapshot;

/** Money still owed on a turf booking itself (0 once merged / on the tab).
 * Optional `settings` passes through to bookingGrossTotal() for callers
 * (like periodStats()) aggregating under an explicit settings object rather
 * than the live app settings — see bookingGrossTotal()'s doc comment. */
export function bookingDue(
  b: DueBooking,
  entries: TabEntry[] = [],
  settings?: Parameters<typeof bookingGrossTotal>[1],
) {
  if (!isFinancialBooking(b)) return 0;
  // Tax-inclusive, exactly like billDue() via billGrossTotal(): what the
  // booking's receipt printed as Grand Total, less what was collected.
  const raw = bookingGrossTotal(b, settings) - num(b.advance_paid);
  const onTab = netTabAmountFor(entries, TAB_REF_TURF_BOOKING, b.id);
  return Math.max(0, round2(raw - onTab));
}

/**
 * REAL cash handed over against a booking — never `advance_paid` at face value.
 *
 * "Put balance on tab" (TurfTab) settles a booking by writing
 * `advance_paid = bookingGrossTotal(b)` while posting the remainder as a tab
 * charge. Reading `advance_paid` as collected money would count that rupee
 * twice: once here, and again as a tab payment when the customer actually pays
 * the tab down. Subtracting whatever the tab still owns for this booking
 * undoes exactly that inflation.
 *
 * Every "collected / received / paid" figure for a booking (analytics,
 * payment split, merges, screens) must go through this.
 */
export function bookingCashCollected(
  b: Pick<TurfBooking, "id" | "advance_paid">,
  entries: TabEntry[] = [],
) {
  const onTab = netTabAmountFor(entries, TAB_REF_TURF_BOOKING, b.id);
  return Math.max(0, round2(num(b.advance_paid) - onTab));
}

/**
 * True when a booking's balance now lives on the customer's running tab: the
 * booking itself owes nothing, payment happens on the Dues tab, and the row
 * stays visible but greyed out (mirror of `billMovedToDues`).
 */
export function bookingMovedToDues(
  b: Pick<TurfBooking, "id" | "status" | "merged_into_bill_id">,
  entries: TabEntry[] = [],
) {
  if (b.merged_into_bill_id) return false;
  return netTabAmountFor(entries, TAB_REF_TURF_BOOKING, b.id) > 0;
}

/**
 * True when a snack sale's money sits on the running tab (billed "On tab", or
 * a charge posted against the sale) rather than collected at the counter.
 */
export function saleMovedToDues(
  s: Pick<SnackSale, "id" | "payment_mode" | "merged_into_bill_id">,
  entries: TabEntry[] = [],
) {
  if (s.merged_into_bill_id) return false;
  return (
    (s.payment_mode ?? "") === TAB_PAYMENT_MODE ||
    netTabAmountFor(entries, TAB_REF_SNACK_SALE, s.id) > 0
  );
}

/**
 * Money still owed on a bill itself.
 *
 * A bill saved as "On tab" is owned by the running tab — its remainder is
 * already a tab charge, so the bill's own due is 0 and the money is counted
 * exactly once. Any other bill owes `total - amount_paid`, less anything that
 * was separately pushed onto the tab against it.
 */
export function billDue(bill: Bill, entries: TabEntry[] = []) {
  // A cancelled bill is a void record, not an unpaid one — see BillStatus
  // in biz.ts. Its sources (if any) already got their own dues back via
  // unmergeBill(id, { cancel: true }), so counting a due here too would
  // double the same money.
  if (bill.status === "cancelled") return 0;
  if ((bill.payment_mode ?? "") === TAB_PAYMENT_MODE) return 0;
  const onTab = netTabAmountFor(entries, TAB_REF_BILL, bill.id);
  return Math.max(0, round2(balanceOf(bill) - onTab));
}

/**
 * True when a bill's remaining balance has been moved onto the customer's
 * running tab — the bill itself owes nothing (`billDue` is 0) but money is
 * still outstanding on the tab. Such bills stay in the Bills list greyed
 * out; payment happens from the Dues tab.
 */
export function billMovedToDues(bill: Bill, entries: TabEntry[] = []) {
  if (bill.status === "cancelled") return false;
  return balanceOf(bill) > 0 && billDue(bill, entries) === 0;
}

/**
 * A snack sale never carries a due of its own: it is either paid at the
 * counter or billed "On tab", in which case the tab ledger owns the money.
 */
export const snackSaleDue = () => 0;

/* ---------- due numbers ---------- */

/** DDMMYY stamp from an ISO date ("2026-09-05" → "050926"). */
const ddmmyy = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}${m[2]}${m[1]!.slice(2)}` : "000000";
};

/** Earliest date a charge hit the tab for one source record — its "moved to dues" date. */
export function tabChargeDateFor(
  entries: TabEntry[],
  refType: string,
  refId: string | null | undefined,
) {
  if (!refId) return null;
  let first: string | null = null;
  for (const e of entries) {
    if (e.ref_type !== refType || e.ref_id !== refId || e.kind !== "charge")
      continue;
    if (!first || e.entry_date < first) first = e.entry_date;
  }
  return first;
}

/**
 * Due number for a record whose balance moved onto a customer's tab:
 * `D-<move date DDMMYY>-<original number>`, e.g. `D-050926-INV-0007`.
 * Derived on display from the ledger + record, never stored, so existing
 * data needs no migration.
 */
export function dueNoFor(originalNo: string, dateISO: string) {
  return `D-${ddmmyy(dateISO)}-${originalNo}`;
}

/**
 * Due number for a source record (bill/booking/sale). Uses the earliest tab
 * charge against it as the move date, falling back to the record's own date
 * (e.g. a bill created directly "On tab" never gets a bill-referenced charge).
 */
export function dueNoForRef(
  entries: TabEntry[],
  refType: string,
  refId: string | null | undefined,
  originalNo: string,
  fallbackDate: string,
) {
  return dueNoFor(
    originalNo,
    tabChargeDateFor(entries, refType, refId) ?? fallbackDate,
  );
}

export type DueLine = {
  kind: "tab" | "booking" | "bill";
  label: string;
  amount: number;
  date: string;
  /** Record id for "booking"/"bill" lines, so a screen can act on this exact
   * record (collect a payment, mark paid) instead of only displaying it.
   * Absent for "tab" lines — those are collected via the tab entry APIs. */
  id?: string;
};

export type CustomerDues = {
  tab: number;
  bookings: number;
  bills: number;
  total: number;
  lines: DueLine[];
};

/**
 * Everything one customer owes, with the contributing rows so any screen can
 * show the breakdown instead of re-deriving it.
 */
export function customerOutstanding(
  customer: { name: string; phone?: string | null },
  src: {
    bills?: Bill[];
    bookings?: TurfBooking[];
    tabEntries?: TabEntry[];
    tabBalance?: number;
    /**
     * Optional record matcher. Defaults to tab-identity (phone, else name).
     * Screens that group by display name pass their own name comparison so a
     * record saved without a phone still lands on the right customer.
     */
    match?: (
      name: string | null | undefined,
      phone: string | null | undefined,
    ) => boolean;
  },
): CustomerDues {
  const key = tabKey(customer.name, customer.phone ?? null);
  const belongs =
    src.match ??
    ((n: string | null | undefined, p: string | null | undefined) =>
      tabKey(n, p) === key);
  const entries = (src.tabEntries ?? []).filter((e) => e.customer_key === key);

  // An over-collected tab is credit, not a negative due: clamp at 0 so it can
  // never cancel out a real booking/bill due elsewhere in the total.
  const tab = Math.max(
    0,
    src.tabBalance ??
      round2(
        entries.reduce(
          (s, e) => s + (e.kind === "charge" ? num(e.amount) : -num(e.amount)),
          0,
        ),
      ),
  );

  const lines: DueLine[] = [];
  if (tab > 0)
    lines.push({ kind: "tab", label: "Running tab", amount: tab, date: "" });

  let bookings = 0;
  for (const b of src.bookings ?? []) {
    if (!belongs(b.customer_name, b.phone)) continue;
    const due = bookingDue(b, entries);
    if (due <= 0) continue;
    bookings += due;
    lines.push({
      kind: "booking",
      label: `Booking ${b.booking_no}`,
      amount: due,
      date: b.booking_date,
      id: b.id,
    });
  }

  let bills = 0;
  for (const bill of src.bills ?? []) {
    if (!belongs(bill.customer_name, bill.customer_phone)) continue;
    const due = billDue(bill, entries);
    if (due <= 0) continue;
    bills += due;
    lines.push({
      kind: "bill",
      label: `Bill ${bill.invoice_no}`,
      amount: due,
      date: bill.bill_date,
      id: bill.id,
    });
  }

  return {
    tab: round2(tab),
    bookings: round2(bookings),
    bills: round2(bills),
    total: round2(tab + bookings + bills),
    lines,
  };
}

/**
 * Money actually received against a bill.
 *
 * An "On tab" bill is stored with `amount_paid` = what was really collected on
 * the source records, and the remainder sits on the tab — so "On tab" is never
 * treated as a payment method and revenue is never inflated.
 */
export function billCollected(bill: Bill) {
  // A void bill never counts as revenue, even if it shows an old
  // `amount_paid` left over from before it was cancelled (kept only for
  // the historical record — see BillStatus in biz.ts).
  if (bill.status === "cancelled") return 0;
  if ((bill.payment_mode ?? "") === TAB_PAYMENT_MODE)
    return Math.max(0, rupees(bill.amount_paid));
  // A bill marked paid has a zero balance, so its collected amount is the full
  // gross total (tax included) regardless of what `amount_paid` was left at.
  return bill.status === "paid"
    ? round2(billGrossTotal(bill))
    : rupees(bill.amount_paid);
}

/** Money actually received for a snack sale (an "On tab" sale collects
 * nothing). Optional `settings`, same reason as bookingDue(). */
export function snackSaleCollected(
  s: Pick<
    SnackSale,
    "payment_mode" | "total" | "tax_amount" | "tax_lines" | "cancelled"
  >,
  settings?: Parameters<typeof snackSaleGrossTotal>[1],
) {
  // A voided sale never counts as revenue, even if it shows an old
  // `payment_mode` left over from before it was cancelled — mirror of
  // billCollected()'s `status === "cancelled"` early return.
  if (s.cancelled) return 0;
  return s.payment_mode === TAB_PAYMENT_MODE
    ? 0
    : snackSaleGrossTotal(s, settings);
}

/** Human label for a snack sale's tab/merge/void state (used by the Snacks
 * list). Cancelled is checked first: a voided sale's old `payment_mode`
 * (e.g. "On tab") is stale and shouldn't still be advertised as owing. */
export function saleStateLabel(
  s: Pick<SnackSale, "merged_into_bill_id" | "payment_mode" | "cancelled">,
  invoiceNo?: string | null,
) {
  if (s.cancelled) return "Cancelled";
  if (s.merged_into_bill_id)
    return invoiceNo ? `Merged into ${invoiceNo}` : "Merged into bill";
  if (s.payment_mode === TAB_PAYMENT_MODE) return "On tab";
  return null;
}

/** Human label for a booking's tab/merge state (used by the Turf list). */
export function bookingStateLabel(
  b: Pick<TurfBooking, "id" | "merged_into_bill_id">,
  entries: TabEntry[] = [],
  invoiceNo?: string | null,
) {
  if (b.merged_into_bill_id)
    return invoiceNo ? `Merged into ${invoiceNo}` : "Merged into bill";
  if (netTabAmountFor(entries, TAB_REF_TURF_BOOKING, b.id) > 0) return "On tab";
  return null;
}

export type LedgerGroup = {
  key: string;
  /** Human label naming the source record ("Booking B-12", "Manual due"). */
  label: string;
  /** Due number (D-<moved date>-<original no>) for record-backed lines. */
  dueNo: string | null;
  refType: string | null;
  refId: string | null;
  charged: number;
  paid: number;
  /** Still sitting on the tab for this source (never negative). */
  net: number;
  /** Most recent activity date for the group. */
  date: string;
};

/**
 * Group one customer's tab ledger into one line per source record, so the Dues
 * tab can show WHERE a balance came from instead of a flat list of entries.
 *
 * Loose payments (no ref) and manual dues collapse into their own lines; a
 * `merge_reverse` entry is netted against the source it was pulled off, which
 * is exactly why a merged booking/sale disappears from the tab breakdown.
 */
export function groupTabLedger(
  entries: TabEntry[],
  src: {
    bills?: Pick<Bill, "id" | "invoice_no">[];
    bookings?: Pick<TurfBooking, "id" | "booking_no">[];
    sales?: Pick<SnackSale, "id" | "bill_no">[];
  } = {},
): LedgerGroup[] {
  const billNo = new Map((src.bills ?? []).map((b) => [b.id, b.invoice_no]));
  const bookingNo = new Map(
    (src.bookings ?? []).map((b) => [b.id, b.booking_no]),
  );
  const saleNo = new Map((src.sales ?? []).map((s) => [s.id, s.bill_no]));

  const noFor = (refType: string | null, refId: string | null) => {
    if (refType === TAB_REF_TURF_BOOKING)
      return bookingNo.get(refId ?? "") ?? null;
    if (refType === TAB_REF_SNACK_SALE) return saleNo.get(refId ?? "") ?? null;
    if (refType === TAB_REF_BILL) return billNo.get(refId ?? "") ?? null;
    return null;
  };

  const labelFor = (
    refType: string | null,
    refId: string | null,
    note: string | null,
  ) => {
    if (refType === TAB_REF_TURF_BOOKING)
      return `Booking ${bookingNo.get(refId ?? "") ?? "(removed)"}`;
    if (refType === TAB_REF_SNACK_SALE)
      return `Snack bill ${saleNo.get(refId ?? "") ?? "(removed)"}`;
    if (refType === TAB_REF_BILL)
      return `Bill ${billNo.get(refId ?? "") ?? "(removed)"}`;
    return note?.trim() || "Manual entry";
  };

  const groups = new Map<string, LedgerGroup>();
  for (const e of entries) {
    // A merge reversal belongs to the source it cancels, not to a line of its own.
    const refType =
      e.ref_type === TAB_REF_MERGE_REVERSE
        ? (e.source_ref_type ?? null)
        : (e.ref_type ?? null);
    const refId =
      e.ref_type === TAB_REF_MERGE_REVERSE
        ? (e.source_ref_id ?? null)
        : (e.ref_id ?? null);
    const key = refType && refId ? `${refType}:${refId}` : `free:${e.kind}`;
    const g = groups.get(key) ?? {
      key,
      label:
        refType && refId
          ? labelFor(refType, refId, e.note)
          : e.kind === "payment"
            ? "Payments received"
            : "Manual dues",
      dueNo: null,
      refType,
      refId,
      charged: 0,
      paid: 0,
      net: 0,
      date: "",
    };
    if (e.kind === "charge") g.charged = round2(g.charged + num(e.amount));
    else g.paid = round2(g.paid + num(e.amount));
    g.net = round2(g.charged - g.paid);
    if (e.entry_date > g.date) g.date = e.entry_date;
    groups.set(key, g);
  }

  // Stamp record-backed groups with their due number once the full group is
  // known (the move date is the earliest charge against that source).
  for (const g of groups.values()) {
    const originalNo = noFor(g.refType, g.refId);
    if (originalNo && g.refType && g.refId) {
      g.dueNo = dueNoForRef(entries, g.refType, g.refId, originalNo, g.date);
    }
  }

  return [...groups.values()].sort(
    (a, b) => b.net - a.net || b.date.localeCompare(a.date),
  );
}
