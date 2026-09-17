/**
 * Merging turf bookings + snack sales into ONE bill, and putting everything
 * back when that bill is un-merged or deleted.
 *
 * The whole merge is a single Dexie transaction: the bill row, the
 * merged_into_bill_id flags and every ledger write land together or not at
 * all, so a failure can never leave a half-reversed tab.
 *
 * Money rules (see lib/dues.ts for the read side):
 * - Each source's *net remaining* tab charge is reversed against the exact
 *   amount that source put on the tab (never capped at the live tab balance),
 *   tagged `merge_reverse` + the source ref so it can be put back exactly.
 * - When "on tab" is ticked the merged bill posts ONE charge for the whole
 *   outstanding amount. Net effect on the tab is `outstanding - alreadyOnTab`,
 *   but as two traceable rows instead of one silently netted figure.
 * - The bill's `amount_paid` is what was actually COLLECTED on the sources —
 *   an "On tab" bill is not revenue received.
 */

import {
  hasCustomNumbering,
  nextCustomInvoiceNo,
  readAppSettings,
  taxBreakdown,
} from "./settings";
import {
  billGrossTotal,
  snackSaleGrossTotal,
  type Bill,
  type BillItem,
  type BillStatus,
  type Unit,
} from "./biz";
import { netTabAmountFor } from "./dues";
import { rupees } from "./money";
import {
  db,
  newId,
  nextInvoiceNo,
  nowIso,
  type BillRow,
  type SnackSaleRow,
  type TabEntryRow,
  type TurfBookingRow,
} from "./localdb";
import { TAB_PAYMENT_MODE } from "./ops";
import {
  TAB_REF_BILL,
  TAB_REF_MERGE_REVERSE,
  TAB_REF_SNACK_SALE,
  TAB_REF_TURF_BOOKING,
  writeTabEntries,
  type AddTabEntryInput,
} from "./tabs";

const num = (v: unknown) => Number(v) || 0;
/** Merged bills are whole rupees like every other amount (lib/money.ts). */
const round2 = rupees;

export type MergeInput = {
  name: string;
  phone: string | null;
  bookingIds: string[];
  saleIds: string[];
  items: BillItem[];
  subtotal: number;
  discount: number;
  total: number;
  putOnTab: boolean;
};

export type MergePreview = {
  total: number;
  /** Money already received on the selected sources (advances, paid sales). */
  collected: number;
  /** Net amount those sources already put on the customer's tab. */
  alreadyOnTab: number;
  /** Still owed after the collections above. */
  outstanding: number;
  /** What the tab balance changes by when "on tab" is ticked. */
  tabDelta: number;
};

type Source =
  | {
      kind: typeof TAB_REF_TURF_BOOKING;
      id: string;
      label: string;
      collected: number;
    }
  | {
      kind: typeof TAB_REF_SNACK_SALE;
      id: string;
      label: string;
      collected: number;
    };

/**
 * Real cash collected on a booking — NOT just `advance_paid` at face value.
 *
 * "Put balance on tab" (TurfTab.tsx) zeroes out a booking's own due by
 * setting `advance_paid` to the FULL `total_amount`, even though only part of
 * that was ever collected in cash — the rest is a charge sitting on the
 * customer's tab. Reading `advance_paid` alone here would count that tab
 * charge as cash TWICE: once as "collected" and again as "already on tab",
 * making `outstanding` (and therefore the merged bill's status/amount_paid)
 * understate — or even zero out — a real due. Subtracting `onTab` undoes
 * exactly that inflation and leaves the genuine cash figure, whether it came
 * from the original advance or from later tab payments.
 */
const bookingCollected = (
  b: Pick<TurfBookingRow, "advance_paid">,
  onTab: number,
) => Math.max(0, num(b.advance_paid) - onTab);
const saleCollected = (
  s: Pick<SnackSaleRow, "payment_mode" | "total" | "tax_amount" | "tax_lines">,
) => (s.payment_mode === TAB_PAYMENT_MODE ? 0 : snackSaleGrossTotal(s));

/** Shared money math, used by both the dialog preview and the merge itself. */
export function mergeMath(
  total: number,
  sources: { collected: number; onTab: number }[],
): MergePreview {
  const collectedRaw = sources.reduce((s, x) => s + x.collected, 0);
  const collected = round2(Math.min(total, collectedRaw));
  const alreadyOnTab = round2(sources.reduce((s, x) => s + x.onTab, 0));
  const outstanding = round2(Math.max(0, total - collected));
  return {
    total: round2(total),
    collected,
    alreadyOnTab,
    outstanding,
    tabDelta: round2(outstanding - alreadyOnTab),
  };
}

/**
 * A merged bill's tax, computed exactly the way a normal bill's is: on the
 * post-discount taxable amount, one rounding per tax line, CGST/SGST split
 * equally. Merge math (outstanding, tab charge) runs on `gross` so the amount
 * posted to the customer's tab is the same tax-inclusive figure the printed
 * invoice shows as Balance due — never the bare pre-tax total.
 */
export function mergeTax(
  total: number,
  s: Parameters<typeof taxBreakdown>[1] = readAppSettings(),
) {
  const taxable = round2(total);
  const { taxAmount, lines } = taxBreakdown(taxable, s);
  return { taxable, taxAmount, taxLines: lines, gross: taxable + taxAmount };
}

/** Preview figures for the merge dialog (no writes). */
export function previewMerge(args: {
  total: number;
  /** Tax settings; defaults to the ones in effect right now. */
  settings?: Parameters<typeof taxBreakdown>[1];
  bookings: { id: string; advance_paid: number }[];
  sales: { id: string; total: number; payment_mode: string }[];
  tabEntries: TabEntryRow[];
}): MergePreview {
  return mergeMath(
    mergeTax(args.total, args.settings ?? readAppSettings()).gross,
    [
      ...args.bookings.map((b) => {
        const onTab = netTabAmountFor(
          args.tabEntries,
          TAB_REF_TURF_BOOKING,
          b.id,
        );
        return { collected: bookingCollected(b, onTab), onTab };
      }),
      ...args.sales.map((s) => ({
        collected: saleCollected(s),
        onTab: netTabAmountFor(args.tabEntries, TAB_REF_SNACK_SALE, s.id),
      })),
    ],
  );
}

type MergeableBooking = {
  id: string;
  booking_no: string;
  slot_name: string;
  hours: number;
  rate_per_hour: number;
  turf_amount: number;
  total_amount: number;
  discount: number;
};
type MergeableSaleItem = {
  item_name: string;
  qty: number;
  unit_price: number;
  amount: number;
};
type MergeableSale = { items: MergeableSaleItem[] };

export type MergedItemsResult = {
  items: BillItem[];
  /** Sum of every booking's pre-discount turf gross + every snack item — the
   * merged bill's "Subtotal" line, before the discount below is taken off. */
  subtotal: number;
  /** Sum of each selected booking's own discount, pulled back in so a merged
   * bill can't overcharge for an offer that was already applied. */
  discount: number;
  /** subtotal − discount, never negative. */
  total: number;
};

/**
 * Builds the merged bill's line items plus subtotal/discount/total from the
 * picked turf bookings + snack bills. Shared by the dialog's live preview and
 * the actual save, so the number shown before merging can never disagree with
 * what gets written.
 *
 * `turf_amount` is every booking's pre-discount gross under the current
 * schema. A row restored from a backup taken before that field existed has it
 * as 0/undefined — falling back to `total_amount` there would be wrong, since
 * total_amount is already NET of that booking's discount, and the discount
 * gets pulled back in again below. `total_amount + discount` reconstructs the
 * true gross correctly in both cases: for current bookings this branch never
 * runs; for legacy rows, total_amount has always equalled turf_amount minus
 * discount, so adding the discount back recovers turf_amount exactly.
 */
export function buildMergedItems(
  bookings: MergeableBooking[],
  sales: MergeableSale[],
): MergedItemsResult {
  const items: BillItem[] = [];
  for (const b of bookings) {
    // Older rows use zero when turf_amount was not present. Reconstruct those
    // rows from their net total plus the already-applied discount; current
    // rows carry the positive pre-discount turf_amount directly.
    const storedTurf = Number(b.turf_amount) || 0;
    const turfGross =
      storedTurf > 0 ? storedTurf : b.total_amount + (Number(b.discount) || 0);
    items.push({
      item: `Turf · ${b.slot_name} (${b.booking_no})`,
      qty: b.hours || 1,
      rate: b.rate_per_hour || turfGross,
      total: turfGross,
      unit: "hr" as Unit,
    });
  }
  for (const sale of sales)
    for (const it of sale.items)
      items.push({
        item: it.item_name,
        qty: it.qty,
        rate: it.unit_price,
        total: it.amount,
        unit: "pcs" as Unit,
      });

  const subtotal = round2(items.reduce((s, i) => s + i.total, 0));
  const discount = round2(
    bookings.reduce((s, b) => s + (Number(b.discount) || 0), 0),
  );
  const total = round2(Math.max(0, subtotal - discount));
  return { items, subtotal, discount, total };
}

async function issueInvoiceNo() {
  const appSettings = readAppSettings();
  if (hasCustomNumbering(appSettings)) {
    const existing = await db.bills.orderBy("invoice_no").keys();
    return nextCustomInvoiceNo(existing as string[], appSettings);
  }
  return nextInvoiceNo();
}

/**
 * Creates the merged bill and re-points every source due at it, in one
 * transaction. Refuses to merge a record that is already on another bill.
 */
export async function mergeIntoBill(input: MergeInput): Promise<Bill> {
  const name = input.name.trim();
  if (!name) throw new Error("Customer name is required for a merged bill");
  if (input.bookingIds.length + input.saleIds.length === 0)
    throw new Error("Select at least one turf booking or snack bill");

  return db.transaction(
    "rw",
    [
      db.bills,
      db.counters,
      db.turf_bookings,
      db.snack_sales,
      db.customer_tabs,
      db.tab_entries,
    ],
    async () => {
      const bookings: TurfBookingRow[] = [];
      for (const id of input.bookingIds) {
        const row = await db.turf_bookings.get(id);
        if (!row) throw new Error("A selected booking no longer exists");
        if (row.merged_into_bill_id)
          throw new Error(
            `Booking ${row.booking_no} is already on another bill`,
          );
        bookings.push(row);
      }
      const sales: SnackSaleRow[] = [];
      for (const id of input.saleIds) {
        const row = await db.snack_sales.get(id);
        if (!row) throw new Error("A selected snack bill no longer exists");
        if (row.merged_into_bill_id)
          throw new Error(
            `Snack bill ${row.bill_no} is already on another bill`,
          );
        sales.push(row);
      }

      const ledger = await db.tab_entries.toArray();
      const sources: (Source & { onTab: number })[] = [
        ...bookings.map((b) => {
          const onTab = netTabAmountFor(ledger, TAB_REF_TURF_BOOKING, b.id);
          return {
            kind: TAB_REF_TURF_BOOKING as typeof TAB_REF_TURF_BOOKING,
            id: b.id,
            label: b.booking_no,
            collected: bookingCollected(b, onTab),
            onTab,
          };
        }),
        ...sales.map((s) => ({
          kind: TAB_REF_SNACK_SALE as typeof TAB_REF_SNACK_SALE,
          id: s.id,
          label: s.bill_no,
          collected: saleCollected(s),
          onTab: netTabAmountFor(ledger, TAB_REF_SNACK_SALE, s.id),
        })),
      ];

      // Tax frozen at creation (see mergeTax / lib/biz.ts billGrossTotal), and
      // the merge math runs on the tax-INCLUSIVE gross so the tab charge in
      // step 2 matches the invoice's Balance due exactly.
      const tax = mergeTax(input.total);
      const math = mergeMath(tax.gross, sources);
      const billId = newId();
      const status: BillStatus =
        math.collected >= math.total && math.total > 0
          ? "paid"
          : math.collected > 0
            ? "partial"
            : "unpaid";

      const row: BillRow = {
        id: billId,
        invoice_no: await issueInvoiceNo(),
        customer_name: name,
        customer_phone: input.phone?.trim() || null,
        items: input.items as unknown as unknown[],
        subtotal: round2(input.subtotal),
        discount: round2(input.discount),
        total: tax.taxable,
        tax_amount: tax.taxAmount,
        tax_lines: tax.taxLines,
        // Only money genuinely received. The rest, on an "On tab" bill, is a
        // tab charge — never counted here as collected revenue.
        amount_paid: math.collected,
        status: input.putOnTab && status === "paid" ? "paid" : status,
        payment_mode: input.putOnTab ? TAB_PAYMENT_MODE : null,
        bill_date: nowIso(),
        created_at: nowIso(),
      };
      await db.bills.add(row);

      const bill: Bill = {
        ...row,
        items: input.items,
        status: row.status as BillStatus,
      };

      // 1. Pull each source's exact remaining charge off the tab, tagged so an
      //    un-merge can put it back.
      const writes: AddTabEntryInput[] = sources
        .filter((s) => s.onTab > 0)
        .map((s) => ({
          name,
          phone: input.phone,
          kind: "payment" as const,
          business: "Shared",
          amount: s.onTab,
          note: `Moved to bill ${row.invoice_no} (${s.label})`,
          ref_type: TAB_REF_MERGE_REVERSE,
          ref_id: billId,
          source_ref_type: s.kind,
          source_ref_id: s.id,
        }));

      // 2. The merged bill carries the whole outstanding amount when the
      //    operator puts it on the tab.
      if (input.putOnTab && math.outstanding > 0) {
        writes.push({
          name,
          phone: input.phone,
          kind: "charge",
          business: "Shared",
          amount: math.outstanding,
          note: `Merged bill ${row.invoice_no}`,
          ref_type: TAB_REF_BILL,
          ref_id: billId,
        });
      }
      await writeTabEntries(writes);

      // 3. Sources keep existing but stop being their own financial record.
      for (const b of bookings)
        await db.turf_bookings.update(b.id, { merged_into_bill_id: billId });
      for (const s of sales)
        await db.snack_sales.update(s.id, { merged_into_bill_id: billId });

      return bill;
    },
  );
}

/**
 * Puts a merged bill's dues back exactly where they came from: sources are
 * released, the bill's own tab charge is reversed, and every `merge_reverse`
 * row is re-charged against its original source.
 */
export async function unmergeBill(
  billId: string,
  options: { deleteBill?: boolean; cancel?: boolean } = {},
) {
  await db.transaction(
    "rw",
    [
      db.bills,
      db.turf_bookings,
      db.snack_sales,
      db.customer_tabs,
      db.tab_entries,
    ],
    async () => {
      const bill = await db.bills.get(billId);
      const invoiceNo = bill?.invoice_no ?? "bill";
      const name = bill?.customer_name?.trim() ?? "";
      const phone = bill?.customer_phone ?? null;

      const bookings = await db.turf_bookings
        .filter((b) => b.merged_into_bill_id === billId)
        .toArray();
      const sales = await db.snack_sales
        .filter((s) => s.merged_into_bill_id === billId)
        .toArray();
      for (const b of bookings)
        await db.turf_bookings.update(b.id, { merged_into_bill_id: null });
      for (const s of sales)
        await db.snack_sales.update(s.id, { merged_into_bill_id: null });

      const ledger = await db.tab_entries.toArray();
      const writes: AddTabEntryInput[] = [];

      // The bill's own charge goes away with the bill.
      const billOnTab = netTabAmountFor(ledger, TAB_REF_BILL, billId);
      if (billOnTab > 0 && name) {
        writes.push({
          name,
          phone,
          kind: "payment" as const,
          business: "Shared",
          amount: billOnTab,
          note: `Un-merged ${invoiceNo}`,
          ref_type: TAB_REF_BILL,
          ref_id: billId,
        });
      }

      // Each reversed source charge comes back, once, against its own record.
      const reversals = ledger.filter(
        (e) =>
          e.ref_type === TAB_REF_MERGE_REVERSE &&
          e.ref_id === billId &&
          e.kind === "payment",
      );
      for (const e of reversals) {
        const restored = netTabAmountFor(
          ledger,
          e.source_ref_type ?? "",
          e.source_ref_id,
        );
        // Only restore what isn't already back on the tab (guards a repeat un-merge).
        const amount = round2(num(e.amount) - restored);
        if (amount <= 0 || !name) continue;
        writes.push({
          name,
          phone,
          kind: "charge" as const,
          business:
            e.source_ref_type === TAB_REF_SNACK_SALE ? "Snacks" : "Turf",
          amount,
          note: `Restored from ${invoiceNo}`,
          ref_type: e.source_ref_type ?? null,
          ref_id: e.source_ref_id ?? null,
        });
      }
      if (writes.length) await writeTabEntries(writes);

      // The merge_reverse rows have served their purpose; dropping them keeps
      // the ledger readable and makes a second un-merge a no-op.
      if (reversals.length)
        await db.tab_entries.bulkDelete(reversals.map((r) => r.id));

      if (options.deleteBill) {
        await db.bills.delete(billId);
      } else if (options.cancel) {
        // Void, not delete: the row stays as a historical record (its
        // invoice number is never reused) but `status: "cancelled"` makes
        // every money calculation treat it as carrying no due and no
        // revenue — see the early-return checks in dues.ts's
        // billDue/billCollected/billMovedToDues and biz.ts's balanceOf.
        // `payment_mode` is cleared rather than reused for the
        // TAB_PAYMENT_MODE zero-due trick below: a cancelled bill isn't
        // "on tab", it's void, and the receipt/list views should stop
        // showing a stale "Paid via ___" line for it.
        await db.bills.update(billId, {
          status: "cancelled",
          payment_mode: null,
        });
      } else if (bill) {
        // Un-merging without deleting still has to stop this bill from
        // showing its own due — its sources just got their dues back above,
        // so a bill that keeps claiming the same balance would double-count
        // it (a customer owing ₹600 on the restored booking AND ₹600 on the
        // orphaned bill for one real ₹600 due). `payment_mode: TAB_PAYMENT_MODE`
        // is the exact flag `billDue()`/`billCollected()` already use to mean
        // "this balance belongs elsewhere, not to this record" (see how a
        // merged-onto-tab bill uses it) — reusing it here makes the bill's own
        // due read as 0 while still correctly crediting it with only the cash
        // it actually collected (bill.amount_paid, untouched), not the full
        // total. The bill stays around as a historical record with no live
        // due of its own.
        await db.bills.update(billId, { payment_mode: TAB_PAYMENT_MODE });
      }
    },
  );
}

/** True when this bill was produced by a merge (it owns source records). */
export async function isMergedBill(billId: string) {
  const booking = await db.turf_bookings
    .filter((b) => b.merged_into_bill_id === billId)
    .first();
  if (booking) return true;
  const sale = await db.snack_sales
    .filter((s) => s.merged_into_bill_id === billId)
    .first();
  return Boolean(sale);
}

/** Gross (tax-inclusive) amount of a merged bill, for display. */
export const mergedBillGross = (bill: Bill) => billGrossTotal(bill);
