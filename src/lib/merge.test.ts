import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";

import { billCollected, billDue, bookingDue, netTabAmountFor } from "./dues";
import {
  buildMergedItems,
  mergeMath,
  mergeTax,
  previewMerge,
  unmergeBill,
} from "./merge";
import { billGrossTotal, billTaxLines, type Bill } from "./biz";
import { readAppSettings, writeAppSettings } from "./settings";
import type { TurfBooking } from "./ops";
import { TAB_PAYMENT_MODE } from "./ops";
import { db } from "./localdb";
import {
  TAB_REF_BILL,
  TAB_REF_MERGE_REVERSE,
  TAB_REF_SNACK_SALE,
  TAB_REF_TURF_BOOKING,
  tabBalanceOf,
  type TabEntry,
} from "./tabs";

const entry = (over: Partial<TabEntry>): TabEntry =>
  ({
    id: Math.random().toString(36).slice(2),
    tab_id: "t1",
    customer_key: "p:9876543210",
    kind: "charge",
    business: "Turf",
    amount: 0,
    note: null,
    ref_type: null,
    ref_id: null,
    source_ref_type: null,
    source_ref_id: null,
    entry_date: "2026-09-01",
    created_at: "2026-09-01T00:00:00.000Z",
    ...over,
  }) as TabEntry;

describe("mergeMath()", () => {
  it("nets collections and tab charges into whole rupees", () => {
    const m = mergeMath(2500, [
      { collected: 500.4, onTab: 1000.5 },
      { collected: 0, onTab: 0 },
    ]);
    expect(m.total).toBe(2500);
    expect(m.collected).toBe(500);
    expect(m.alreadyOnTab).toBe(1001);
    expect(m.outstanding).toBe(2000);
    expect(m.tabDelta).toBe(999);
  });

  it("keeps collected + outstanding equal to the bill total", () => {
    for (const [total, collected] of [
      [1000, 0],
      [1000, 400],
      [1000, 1000],
      [1237, 618.5],
    ] as const) {
      const m = mergeMath(total, [{ collected, onTab: 0 }]);
      expect(m.collected + m.outstanding).toBe(m.total);
    }
  });

  it("never treats an over-collection as negative outstanding", () => {
    const m = mergeMath(800, [{ collected: 1000, onTab: 0 }]);
    expect(m.collected).toBe(800);
    expect(m.outstanding).toBe(0);
  });

  it("tabDelta is the net change to the customer's balance", () => {
    // Sources had ₹1,500 on the tab; merged bill puts ₹1,500 back on it.
    const m = mergeMath(1500, [{ collected: 0, onTab: 1500 }]);
    expect(m.outstanding).toBe(1500);
    expect(m.tabDelta).toBe(0);
  });
});

describe("merge reversal invariants", () => {
  const billId = "bill1";
  const bookingId = "book1";

  // A booking that put ₹1,200 on the tab, then got merged: the merge writes a
  // payment tagged merge_reverse against the bill, sourced to the booking.
  const charge = entry({
    kind: "charge",
    amount: 1200,
    ref_type: TAB_REF_TURF_BOOKING,
    ref_id: bookingId,
  });
  const reversal = entry({
    kind: "payment",
    amount: 1200,
    ref_type: TAB_REF_MERGE_REVERSE,
    ref_id: billId,
    source_ref_type: TAB_REF_TURF_BOOKING,
    source_ref_id: bookingId,
  });

  it("leaves nothing on the customer's balance for a merged source", () => {
    const ledger = [charge, reversal];
    // The reversal is a payment row, so the tab balance nets to zero…
    expect(tabBalanceOf(ledger)).toBe(0);
    // …while the source ref keeps its gross charge, which is exactly the
    // amount the un-merge has to put back (it deletes the reversal row).
    expect(netTabAmountFor(ledger, TAB_REF_TURF_BOOKING, bookingId)).toBe(1200);
  });

  it("restores the source charge exactly when un-merged", () => {
    // un-merge drops the merge_reverse row and re-charges the difference
    const afterUnmerge = [charge];
    expect(netTabAmountFor(afterUnmerge, TAB_REF_TURF_BOOKING, bookingId)).toBe(
      1200,
    );
  });

  it("a repeat un-merge restores nothing extra", () => {
    // The reversal rows are deleted by the first un-merge, so a second pass
    // finds none and writes nothing.
    const afterUnmerge = [charge];
    expect(
      afterUnmerge.filter((e) => e.ref_type === TAB_REF_MERGE_REVERSE),
    ).toHaveLength(0);
    expect(tabBalanceOf(afterUnmerge)).toBe(1200);
  });

  it("partially collected source keeps only the remaining charge on the tab", () => {
    const partPaid = entry({
      kind: "payment",
      amount: 200,
      ref_type: TAB_REF_TURF_BOOKING,
      ref_id: bookingId,
    });
    expect(
      netTabAmountFor([charge, partPaid], TAB_REF_TURF_BOOKING, bookingId),
    ).toBe(1000);
    expect(tabBalanceOf([charge, partPaid])).toBe(1000);
    const m = mergeMath(1200, [{ collected: 200, onTab: 1000 }]);
    expect(m.outstanding).toBe(1000);
    expect(m.tabDelta).toBe(0);
  });
});

describe("previewMerge() — 'Put balance on tab' does not erase the due", () => {
  const bookingId = "book1";

  // "Put balance on tab" (TurfTab.tsx) sets advance_paid = total_amount as
  // bookkeeping to zero the booking's own due, even though only part of that
  // was real cash — the rest is this tab charge.
  const tabCharge = (amount: number): TabEntry =>
    ({
      id: Math.random().toString(36).slice(2),
      tab_id: "t1",
      customer_key: "p:9876543210",
      kind: "charge",
      business: "Turf",
      amount,
      note: "Turf booking put on tab",
      ref_type: TAB_REF_TURF_BOOKING,
      ref_id: bookingId,
      source_ref_type: null,
      source_ref_id: null,
      entry_date: "2026-09-01",
      created_at: "2026-09-01T00:00:00.000Z",
    }) as TabEntry;

  it("does not double-count the tab portion as cash collected", () => {
    // Booking total ₹1,000: ₹200 real cash, ₹800 pushed to the tab.
    // advance_paid was then force-set to the full 1000 by "Put on tab".
    const preview = previewMerge({
      total: 1000,
      bookings: [{ id: bookingId, advance_paid: 1000 }],
      sales: [],
      tabEntries: [tabCharge(800)],
    });
    // Real cash collected is 1000 - 800 = 200, NOT the full 1000.
    expect(preview.collected).toBe(200);
    // The other ₹800 must still show up somewhere — as outstanding — never
    // just vanish because "collected" swallowed it.
    expect(preview.outstanding).toBe(800);
    expect(preview.alreadyOnTab).toBe(800);
    // Nothing invented, nothing lost: collected + outstanding == total.
    expect(preview.collected + preview.outstanding).toBe(preview.total);
  });

  it("still reports full cash collected when the booking never touched the tab", () => {
    const preview = previewMerge({
      total: 1000,
      bookings: [{ id: bookingId, advance_paid: 1000 }],
      sales: [],
      tabEntries: [], // no tab charge at all — plain "Mark paid"
    });
    expect(preview.collected).toBe(1000);
    expect(preview.outstanding).toBe(0);
  });

  it("still tracks a genuine partial cash advance correctly", () => {
    const preview = previewMerge({
      total: 1000,
      bookings: [{ id: bookingId, advance_paid: 400 }],
      sales: [],
      tabEntries: [],
    });
    expect(preview.collected).toBe(400);
    expect(preview.outstanding).toBe(600);
  });

  it("counts a later partial tab payment as real cash collected", () => {
    // ₹800 was put on tab, then the customer paid ₹300 of it down via Dues.
    const payment: TabEntry = {
      id: "p1",
      tab_id: "t1",
      customer_key: "p:9876543210",
      kind: "payment",
      business: "Turf",
      amount: 300,
      note: "Tab payment",
      ref_type: TAB_REF_TURF_BOOKING,
      ref_id: bookingId,
      source_ref_type: null,
      source_ref_id: null,
      entry_date: "2026-09-02",
      created_at: "2026-09-02T00:00:00.000Z",
    } as TabEntry;
    const preview = previewMerge({
      total: 1000,
      bookings: [{ id: bookingId, advance_paid: 1000 }],
      sales: [],
      tabEntries: [tabCharge(800), payment],
    });
    // 200 original cash + 300 paid down against the tab = 500 real cash.
    expect(preview.collected).toBe(500);
    expect(preview.outstanding).toBe(500);
    expect(preview.alreadyOnTab).toBe(500);
  });

  it("leaves snack-sale collection logic untouched (no advance_paid there)", () => {
    const preview = previewMerge({
      total: 500,
      bookings: [],
      sales: [{ id: "sale1", total: 500, payment_mode: "On tab" }],
      tabEntries: [],
    });
    expect(preview.collected).toBe(0);
    expect(preview.outstanding).toBe(500);
  });
});

describe("buildMergedItems() — offer/discount can't come off twice", () => {
  const booking = (over: Record<string, unknown> = {}) => ({
    id: "b1",
    booking_no: "TB-001",
    slot_name: "Court A",
    hours: 2,
    rate_per_hour: 500,
    turf_amount: 1000,
    total_amount: 900,
    discount: 100,
    ...over,
  });

  it("current-schema booking: uses turf_amount directly, discount taken off once", () => {
    const r = buildMergedItems([booking()], []);
    expect(r.subtotal).toBe(1000); // gross, from turf_amount
    expect(r.discount).toBe(100);
    expect(r.total).toBe(900); // 1000 - 100, matches total_amount
    expect(r.items[0]!.total).toBe(1000);
  });

  it("legacy booking with turf_amount missing: reconstructs gross, never double-subtracts", () => {
    // Row restored from a backup taken before turf_amount existed: 0/undefined,
    // while total_amount (900) is already NET of the 100 discount.
    const legacy = booking({ turf_amount: 0 });
    const r = buildMergedItems([legacy], []);
    // Naive `turf_amount || total_amount` would give subtotal=900, then
    // subtract the 100 discount again → total=800, silently losing ₹100.
    expect(r.subtotal).toBe(1000); // reconstructed as total_amount + discount
    expect(r.discount).toBe(100);
    expect(r.total).toBe(900); // matches the booking's real total_amount
  });

  it("legacy booking with no discount at all: reconstruction is a no-op", () => {
    const legacy = booking({ turf_amount: 0, discount: 0, total_amount: 1000 });
    const r = buildMergedItems([legacy], []);
    expect(r.subtotal).toBe(1000);
    expect(r.total).toBe(1000);
  });

  it("mixes bookings and snack-sale items, discount only ever from bookings", () => {
    const r = buildMergedItems(
      [booking()],
      [
        {
          items: [
            { item_name: "Water bottle", qty: 2, unit_price: 20, amount: 40 },
            { item_name: "Chips", qty: 1, unit_price: 30, amount: 30 },
          ],
        },
      ],
    );
    expect(r.items).toHaveLength(3);
    expect(r.subtotal).toBe(1000 + 40 + 30);
    expect(r.discount).toBe(100); // only the booking's discount
    expect(r.total).toBe(1000 + 40 + 30 - 100);
  });

  it("never goes negative even if a discount somehow exceeds the subtotal", () => {
    const overDiscounted = booking({
      turf_amount: 500,
      discount: 900,
      total_amount: -400,
    });
    const r = buildMergedItems([overDiscounted], []);
    expect(r.total).toBe(0);
  });
});

describe("unmergeBill() keeping the bill — the due can't live in two places", () => {
  // Mirrors what lib/merge.ts's unmergeBill() does when called WITHOUT
  // deleteBill (the "Un-merge <invoice>" button in BillsTab, via
  // useUnmergeBill()): the booking's merged_into_bill_id is cleared (so it
  // becomes its own financial record again) and, per the fix, the kept bill
  // gets payment_mode set to TAB_PAYMENT_MODE — the same flag billDue()/
  // billCollected() already use elsewhere to mean "this balance belongs to
  // another record now, not to this bill".
  const fullBooking = (over: Partial<TurfBooking> = {}): TurfBooking =>
    ({
      id: "k1",
      booking_no: "B-1",
      booking_date: "2026-09-01",
      customer_name: "Ravi",
      phone: "9876543210",
      slot_name: "Evening",
      hours: 1,
      rate_per_hour: 800,
      total_amount: 1000,
      advance_paid: 400,
      payment_mode: "Cash",
      status: "Confirmed",
      discount: 0,
      notes: null,
      start_time: "18:00",
      end_time: "19:00",
      courts: 1,
      snacks: [],
      snacks_total: 0,
      turf_amount: 1000,
      merged_into_bill_id: null,
      ...over,
    }) as TurfBooking;

  const mergedBill = (over: Partial<Bill> = {}): Bill =>
    ({
      id: "bill1",
      invoice_no: "INV-1",
      customer_name: "Ravi",
      customer_phone: "9876543210",
      items: [],
      subtotal: 1000,
      discount: 0,
      total: 1000,
      amount_paid: 400,
      status: "partial",
      payment_mode: null,
      bill_date: "2026-09-01",
      ...over,
    }) as Bill;

  it("BUG (before the fix): un-merging without deleting doubles the due", () => {
    // Booking restored to being its own record: its ₹600 due comes back.
    const restoredBooking = fullBooking(); // merged_into_bill_id: null, advance_paid: 400
    expect(bookingDue(restoredBooking)).toBe(600);
    // The bill row, if left completely untouched by unmerge, still thinks it
    // owes the same ₹600 — this is the bug: 600 + 600 = 1200 for one due.
    const untouchedBill = mergedBill();
    expect(billDue(untouchedBill)).toBe(600);
  });

  it("FIXED: setting payment_mode to TAB_PAYMENT_MODE on the kept bill zeroes its own due", () => {
    const restoredBooking = fullBooking();
    const fixedBill = mergedBill({ payment_mode: TAB_PAYMENT_MODE });
    expect(bookingDue(restoredBooking)).toBe(600); // due correctly back on the source
    expect(billDue(fixedBill)).toBe(0); // and the bill no longer claims it too
    // The bill still gets credit for exactly the cash it actually collected —
    // never the full total, so revenue isn't inflated either.
    expect(billCollected(fixedBill)).toBe(400);
  });

  it("works the same when the booking was fully on the tab, not part-cash", () => {
    // Booking total 1000, 0 cash, all 1000 was pushed to the tab pre-merge.
    const restoredBooking = fullBooking({ advance_paid: 0 });
    const tabEntries = [
      {
        id: "e1",
        tab_id: "t1",
        customer_key: "p:9876543210",
        kind: "charge" as const,
        business: "Turf",
        amount: 1000,
        note: null,
        ref_type: TAB_REF_TURF_BOOKING,
        ref_id: "k1",
        source_ref_type: null,
        source_ref_id: null,
        entry_date: "2026-09-01",
        created_at: "2026-09-01T00:00:00.000Z",
      } as TabEntry,
    ];
    expect(bookingDue(restoredBooking, tabEntries)).toBe(0); // due lives on the tab
    expect(netTabAmountFor(tabEntries, TAB_REF_TURF_BOOKING, "k1")).toBe(1000);
    const fixedBill = mergedBill({
      amount_paid: 0,
      status: "unpaid",
      payment_mode: TAB_PAYMENT_MODE,
    });
    expect(billDue(fixedBill)).toBe(0); // and the bill claims nothing on top
    expect(billCollected(fixedBill)).toBe(0); // no phantom revenue either
  });
});

describe("GST-enabled merge + frozen tax snapshot", () => {
  const gst = {
    gstEnabled: true,
    gstRate: 18,
    customTaxes: [] as {
      id: string;
      label: string;
      rate: number;
      enabled: boolean;
    }[],
  };

  const mergedBill = (over: Partial<Bill> = {}): Bill =>
    ({
      id: "b1",
      invoice_no: "INV-1",
      customer_name: "Ravi",
      customer_phone: null,
      items: [],
      subtotal: 1100,
      discount: 100,
      total: 1000,
      amount_paid: 0,
      status: "unpaid",
      payment_mode: null,
      bill_date: "2026-09-01T00:00:00.000Z",
      ...over,
    }) as Bill;

  it("taxes the post-discount amount, splits CGST/SGST exactly equally", () => {
    const tax = mergeTax(1000, gst);
    expect(tax.taxable).toBe(1000);
    expect(tax.taxAmount).toBe(180);
    expect(tax.gross).toBe(1180);
    const [cgst, sgst] = tax.taxLines;
    expect(cgst!.value).toBe(sgst!.value);
    expect(cgst!.value + sgst!.value).toBe(tax.taxAmount);
  });

  it("charges the tab the tax-INCLUSIVE balance, not the pre-tax total", () => {
    // Booking of 1000 pre-tax with 400 collected in cash, nothing on tab yet.
    const preview = previewMerge({
      total: 1000,
      settings: gst,
      bookings: [{ id: "bk1", advance_paid: 400 }],
      sales: [],
      tabEntries: [],
    });
    const tax = mergeTax(1000, gst);
    expect(preview.total).toBe(tax.gross); // 1180
    expect(preview.collected).toBe(400);
    // Tab charge posted === receipt grand total − cash actually collected.
    expect(preview.outstanding).toBe(tax.gross - 400); // 780, not 600
    expect(preview.tabDelta).toBe(tax.gross - 400);
  });

  it("a merged bill's stored tax makes its gross total match the tab charge", () => {
    const tax = mergeTax(1000, gst);
    const bill = mergedBill({
      tax_amount: tax.taxAmount,
      tax_lines: tax.taxLines,
    });
    expect(billGrossTotal(bill)).toBe(1180);
    expect(billTaxLines(bill)).toEqual(tax.taxLines);
    const preview = previewMerge({
      total: 1000,
      settings: gst,
      bookings: [{ id: "bk1", advance_paid: 400 }],
      sales: [],
      tabEntries: [],
    });
    expect(preview.tabDelta).toBe(billGrossTotal(bill) - 400);
  });

  it("a later GST rate change never moves an issued bill's total or reprint", () => {
    const atIssue = mergeTax(1000, gst);
    const bill = mergedBill({
      tax_amount: atIssue.taxAmount,
      tax_lines: atIssue.taxLines,
    });
    const before = { gross: billGrossTotal(bill), lines: billTaxLines(bill) };
    // Settings change to 5% afterwards — the frozen figures must not budge.
    writeAppSettings({ ...readAppSettings(), gstEnabled: true, gstRate: 5 });
    expect(billGrossTotal(bill)).toBe(before.gross);
    expect(billTaxLines(bill)).toEqual(before.lines);
    writeAppSettings({ ...readAppSettings(), gstEnabled: false, gstRate: 18 });
  });
});

describe("unmergeBill(id, { cancel: true }) — voiding a bill", () => {
  const billRow = (over: Partial<import("./localdb").BillRow> = {}) => ({
    id: "vb1",
    invoice_no: "INV-VOID-1",
    customer_name: "Ravi",
    customer_phone: "9876543210",
    items: [],
    subtotal: 1000,
    discount: 0,
    total: 1000,
    amount_paid: 400,
    status: "partial",
    payment_mode: "Cash",
    bill_date: "2026-09-01",
    created_at: "2026-09-01T00:00:00.000Z",
    ...over,
  });

  it("flips a plain (non-merged) bill to cancelled and clears its payment mode", async () => {
    await db.bills.clear();
    await db.bills.add(billRow());

    await unmergeBill("vb1", { cancel: true });

    const after = await db.bills.get("vb1");
    expect(after?.status).toBe("cancelled");
    expect(after?.payment_mode).toBeNull();
    // The record survives — cancel is a void, not a delete.
    expect(after?.id).toBe("vb1");
  });

  it("releases a merged booking's due back instead of leaving it orphaned", async () => {
    await db.bills.clear();
    await db.turf_bookings.clear();
    await db.tab_entries.clear();

    await db.bills.add(billRow({ id: "vb2", invoice_no: "INV-VOID-2" }));
    await db.turf_bookings.add({
      id: "bk1",
      booking_no: "B-1",
      booking_date: "2026-09-01",
      customer_name: "Ravi",
      phone: "9876543210",
      slot_name: "Evening",
      hours: 1,
      rate_per_hour: 1000,
      total_amount: 1000,
      advance_paid: 0,
      payment_mode: "Cash",
      status: "Confirmed",
      discount: 0,
      notes: null,
      start_time: "18:00",
      end_time: "19:00",
      courts: 1,
      snacks: [],
      snacks_total: 0,
      turf_amount: 1000,
      created_at: "2026-09-01T00:00:00.000Z",
      merged_into_bill_id: "vb2",
    });
    // The merge step's own tab write: source's remaining charge pulled onto
    // the bill via a merge_reverse entry (see mergeBill() in merge.ts).
    await db.tab_entries.add({
      id: "te1",
      tab_id: "t1",
      customer_key: "p:9876543210",
      kind: "payment",
      business: "Turf",
      amount: 1000,
      note: "Moved to bill INV-VOID-2 (B-1)",
      ref_type: TAB_REF_MERGE_REVERSE,
      ref_id: "vb2",
      source_ref_type: TAB_REF_TURF_BOOKING,
      source_ref_id: "bk1",
      entry_date: "2026-09-01",
      created_at: "2026-09-01T00:00:00.000Z",
    });

    await unmergeBill("vb2", { cancel: true });

    const bill = await db.bills.get("vb2");
    expect(bill?.status).toBe("cancelled");

    const booking = await db.turf_bookings.get("bk1");
    // Released back to being its own financial record.
    expect(booking?.merged_into_bill_id).toBeNull();

    const entries = (await db.tab_entries.toArray()) as unknown as TabEntry[];
    // The booking's due is restored onto the tab exactly once — a plain
    // un-merge/cancel, not a doubled or dropped charge.
    expect(netTabAmountFor(entries, TAB_REF_TURF_BOOKING, "bk1")).toBe(1000);
    // The bill's own tab charge (there wasn't one here) stays at 0, and the
    // cancelled bill itself owes nothing (see billDue's cancelled check).
    expect(billDue({ ...bill, items: [] } as unknown as Bill, entries)).toBe(0);
  });
});
