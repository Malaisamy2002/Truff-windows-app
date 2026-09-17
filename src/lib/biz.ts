import { money, rupees } from "./money";
import { readAppSettings, taxBreakdown } from "./settings";
import { readPrintSettings } from "./print";

export const BUSINESS_NAME = "Chennai Soccer & Sports School";

/** Resolved shop name for anything that isn't the receipt PDF itself —
 * WhatsApp share text, "copy bill text", history entries. Mirrors the
 * `shopName || BUSINESS_NAME` fallback `receipt.ts` already uses, so a shop
 * that has set its own name in Settings sees it everywhere, not just on the
 * printed/PDF receipt. */
function resolvedBusinessName(): string {
  return readPrintSettings().shopName.trim() || BUSINESS_NAME;
}

export type CalcRow = {
  id: string;
  item: string;
  rate: number;
  qty: number;
  unit: Unit;
};

export type BillItem = {
  item: string;
  rate: number;
  qty: number;
  total: number;
  unit: Unit;
};

/** Editable unit tags shown on each calculator row and printed on bills. */
export const UNITS = [
  "kg",
  "litre",
  "hr",
  "pcs",
  "box",
  "pkt",
  "dozen",
  "g",
] as const;
export type Unit = (typeof UNITS)[number];
export const DEFAULT_UNIT: Unit = "kg";

/** Compact abbreviations for the item-table QTY column on narrow thermal
 *  rolls (50/58/76/80 mm), where that column has very little room. Without
 *  these, a value like "2.5 litre" or "1 dozen" can be wider than the
 *  column, and gets clipped with an ellipsis ("2.5 li…") instead of showing
 *  in full — which reads as the quantity being half-printed. Full unit
 *  names are still used on A4/A5/Letter sheets (plenty of width there) and
 *  in the rate-breakdown sub-line under each item, which has the whole
 *  receipt width to itself. */
export const UNIT_SHORT: Record<Unit, string> = {
  kg: "kg",
  litre: "L",
  hr: "hr",
  pcs: "pcs",
  box: "bx",
  pkt: "pkt",
  dozen: "dz",
  g: "g",
};

/**
 * "cancelled" is a soft-void: the bill stays in the database as a
 * historical record (so an invoice number is never silently reused and
 * the operator can still see what happened), but every money calculation
 * treats it as if it carries no balance and no revenue at all — see the
 * early-return checks in `billDue`/`billCollected`/`billMovedToDues`
 * (dues.ts) and the exclusion in `computePeriodSummary` (analytics.ts).
 * Distinct from a hard delete (`useDeleteBill`), which removes the row
 * entirely; cancelling is `useVoidBill` (data.ts) / `unmergeBill(id,
 * { cancel: true })` (merge.ts).
 */
export type BillStatus = "paid" | "unpaid" | "partial" | "cancelled";

export type Bill = {
  id: string;
  invoice_no: string;
  customer_name: string;
  customer_phone: string | null;
  items: BillItem[];
  subtotal: number;
  discount: number;
  total: number;
  /** Tax snapshot taken when the bill was created (see billGrossTotal). */
  tax_amount?: number;
  tax_lines?: { label: string; value: number }[];
  amount_paid: number;
  status: BillStatus;
  payment_mode?: string | null;
  bill_date: string;
};

export type Expense = {
  id: string;
  category: string;
  note: string | null;
  amount: number;
  spent_at: string;
};

export type HistoryEntry = {
  id: string;
  rows: BillItem[];
  total: number;
  note: string | null;
  created_at: string;
};

export const EXPENSE_CATEGORIES = [
  "ingredients",
  "packaging",
  "transport",
  "labour",
  "other",
] as const;

export const rowTotal = (r: Pick<CalcRow, "rate" | "qty">) =>
  rupees((Number(r.rate) || 0) * (Number(r.qty) || 0));

export { money };

/**
 * Bill/booking/snack-sale display date as "DD-MM-YYYY" — the one format
 * every printed bill, booking receipt, and snack-sale receipt (plus their
 * in-app list/detail views) must use, per the "date-month-year" requirement.
 *
 * `booking_date` and `sale_date` are stored as bare "YYYY-MM-DD" local
 * calendar-date strings (see localDateStr in utils.ts). Passing those to
 * `new Date(...)` parses them as UTC midnight per the JS spec — the exact
 * off-by-one-day trap localDateStr's own comment warns about — so this
 * formats date-only strings by splitting the string directly instead of
 * going through a Date object. `bill_date` is a full ISO timestamp (see
 * nowIso in localdb.ts); for that shape, Date's local getters are safe.
 */
export const formatDMY = (iso: string): string => {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return `${d}-${m}-${y}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso; // fall back to the raw string rather than "Invalid Date"
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${d.getFullYear()}`;
};

/** Same DD-MM-YYYY convention as formatDMY, with a time-of-day suffix for
 * timestamped log entries (Calc history, expense records) where the time
 * matters and not just the day. */
export const shortDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return `${formatDMY(iso)}, ${time}`;
};

export function historyEntryText(entry: HistoryEntry) {
  const lines = entry.rows.map(
    (r) =>
      `${r.item || "Item"} — ${r.qty} ${r.unit ?? "kg"} × ${money(r.rate)} = ${money(r.total)}`,
  );
  return [
    `${resolvedBusinessName()}`,
    shortDate(entry.created_at),
    ...lines,
    `Total: ${money(entry.total)}`,
  ].join("\n");
}

export function billText(bill: Bill) {
  const lines = bill.items.map(
    (r) =>
      `${r.item || "Item"} — ${r.qty} ${r.unit ?? "kg"} × ${money(r.rate)} = ${money(r.total)}`,
  );
  const gross = billGrossTotal(bill);
  const paid = billPaidAmount(bill);
  const due = Math.max(0, gross - paid);
  return [
    `${resolvedBusinessName()}`,
    `Bill ${bill.invoice_no} · ${formatDMY(bill.bill_date)}`,
    `Customer: ${bill.customer_name}`,
    "",
    ...lines,
    "",
    `Subtotal: ${money(bill.subtotal)}`,
    bill.discount ? `Discount: -${money(bill.discount)}` : "",
    `Payable: ${money(gross)}`,
    `Paid: ${money(paid)}`,
    due > 0 ? `Balance due: ${money(due)}` : "",
    `Status: ${bill.status.toUpperCase()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function whatsappUrl(text: string, phone?: string | null) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const to =
    digits.length >= 10 ? (digits.length === 10 ? `91${digits}` : digits) : "";
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function balanceOf(bill: Bill) {
  // Paid and cancelled bills both carry a zero live balance — a cancelled
  // bill is void, not unpaid (see BillStatus).
  if (bill.status === "paid" || bill.status === "cancelled") return 0;
  return Math.max(0, billGrossTotal(bill) - rupees(bill.amount_paid));
}

/** Bill total with every active tax (GST + custom taxes) added on top —
 * the actual amount owed by the customer. `bill.total` alone is the
 * post-discount, pre-tax figure recorded when the bill was made (discount is
 * always applied BEFORE tax). Always a whole rupee. */
export function billGrossTotal(bill: Bill): number {
  const taxable = rupees(bill.total);
  // The rate that applies to an invoice is the one in effect when it was
  // created: a later GST change must not move an issued bill's Grand Total,
  // Paid or Balance Due, and a reprint must match the customer's copy. New
  // bills carry that frozen figure; only legacy rows saved before the
  // snapshot existed fall back to the live settings.
  return grossWithTax(taxable, bill);
}

/** Tax lines to print for a bill — the frozen snapshot when present, else a
 * live recompute for legacy pre-snapshot rows. */
export function billTaxLines(bill: Bill): { label: string; value: number }[] {
  return taxLinesWithFallback(bill.total, bill);
}

/**
 * A record's frozen tax, or a live recompute for legacy rows.
 *
 * Every money document in the app (bill, turf booking, snack sale) stores the
 * tax that applied when it was created, so a later GST rate/toggle change can
 * never move an issued document's total or its reprint. Rows saved before the
 * snapshot existed have no `tax_amount`, and keep the old live-recompute
 * behaviour (documented limitation of pre-fix data).
 */
export type TaxSnapshot = {
  tax_amount?: number;
  tax_lines?: { label: string; value: number }[];
};

/** Compute (and freeze) tax on a taxable amount — discount already deducted. */
export function freezeTax(
  taxable: number,
  s: Parameters<typeof taxBreakdown>[1] = readAppSettings(),
) {
  const base = rupees(taxable);
  const { taxAmount, lines } = taxBreakdown(base, s);
  return { taxable: base, taxAmount, taxLines: lines, gross: base + taxAmount };
}

/** Tax-inclusive total for any record with a taxable amount + tax snapshot.
 * `settings` defaults to the live app settings (correct for receipts, tabs,
 * and any other UI that always wants "right now"'s tax rate), but a caller
 * that's aggregating under an EXPLICIT settings object — e.g. periodStats()
 * previewing a different tax rate, or a hand-computed audit fixture — must
 * pass it through here too. Silently falling back to readAppSettings() in
 * that case would tax bills correctly (they get the caller's settings) while
 * taxing turf bookings/snack sales at whatever the LIVE global settings
 * happen to be — a real, easy-to-miss mismatch, not just a test artifact. */
export function grossWithTax(
  taxable: number,
  rec: TaxSnapshot,
  settings: Parameters<typeof taxBreakdown>[1] = readAppSettings(),
): number {
  const base = rupees(taxable);
  if (typeof rec.tax_amount === "number") return base + rupees(rec.tax_amount);
  return base + taxBreakdown(base, settings).taxAmount;
}

/** Tax lines to print for any record — frozen when present, else live.
 * Same `settings` threading as grossWithTax(), for the same reason. */
export function taxLinesWithFallback(
  taxable: number,
  rec: TaxSnapshot,
  settings: Parameters<typeof taxBreakdown>[1] = readAppSettings(),
): { label: string; value: number }[] {
  if (rec.tax_lines) return rec.tax_lines;
  if (typeof rec.tax_amount === "number") return [];
  return taxBreakdown(rupees(taxable), settings).lines;
}

/** A turf booking's taxable (post-discount, pre-tax) amount. */
export const bookingTaxable = (
  b: Pick<
    TurfBooking_,
    "turf_amount" | "hours" | "rate_per_hour" | "courts"
  > & {
    snacks_total?: number;
    discount?: number;
    total_amount?: number;
  },
): number => {
  // Turf + snacks - discount, recomputed from the parts so a stale
  // total_amount can't understate the bill; total_amount is the fallback for
  // rows that carry no slot/snacks detail.
  const courts = b.courts ?? 1;
  // Older rows were normalised with a zero turf_amount when the field was
  // absent. Treat zero as that legacy-missing sentinel and reconstruct the
  // gross from the booking inputs; a genuinely free booking also has a zero
  // total, so this remains harmless for comped rows.
  const storedTurf = Number(b.turf_amount) || 0;
  const turf =
    storedTurf > 0
      ? storedTurf
      : (b.hours ?? 0) * (b.rate_per_hour ?? 0) * courts;
  const derived = turf + (b.snacks_total ?? 0) - (b.discount ?? 0);
  if (derived > 0) return rupees(derived);
  return Math.max(0, rupees(b.total_amount ?? 0));
};

/** Structural shape of the booking fields these helpers need (avoids a
 * lib/ops.ts import cycle). */
type TurfBooking_ = {
  turf_amount: number;
  hours: number;
  rate_per_hour: number;
  courts: number;
};

/** A booking's tax-inclusive grand total — the figure its receipt prints.
 * Optional `settings` passes through to grossWithTax() for callers (like
 * periodStats()) aggregating under an explicit settings object rather than
 * the live app settings. */
export const bookingGrossTotal = (
  b: Parameters<typeof bookingTaxable>[0] & TaxSnapshot,
  settings?: Parameters<typeof taxBreakdown>[1],
): number => grossWithTax(bookingTaxable(b), b, settings);

/** A snack sale's tax-inclusive grand total — the figure its receipt prints.
 * Optional `settings`, same reason as bookingGrossTotal(). */
export const snackSaleGrossTotal = (
  s: { total: number } & TaxSnapshot,
  settings?: Parameters<typeof taxBreakdown>[1],
): number => grossWithTax(s.total, s, settings);

/** What's actually been paid toward a bill's tax-inclusive total — full
 * gross amount once marked "paid", otherwise whatever's been recorded. */
export function billPaidAmount(bill: Bill): number {
  return bill.status === "paid"
    ? billGrossTotal(bill)
    : Number(bill.amount_paid) || 0;
}

/** Case/whitespace-insensitive name match, used to tie free-text customer_name
 * fields on bills/bookings/sales back to a saved customer. */
export const sameCustomerName = (a: string | null | undefined, b: string) =>
  (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

/** Visits at or above this count earn the VIP tag; below it, "Regular". */
export const VIP_VISIT_THRESHOLD = 5;

export type CustomerTag = "VIP" | "Regular" | "New";

export function customerTag(visits: number): CustomerTag {
  if (visits >= VIP_VISIT_THRESHOLD) return "VIP";
  if (visits > 0) return "Regular";
  return "New";
}
