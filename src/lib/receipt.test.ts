import { describe, expect, it } from "vitest";

import {
  billReceipt,
  bookingReceipt,
  snackSaleReceipt,
  receiptText,
} from "./receipt";
import { freezeTax, type Bill } from "./biz";
import type { SnackSale, TurfBooking } from "./ops";
import { bookingDue, snackSaleCollected } from "./dues";

/**
 * These tests pin down the ONE rule every printed invoice must follow:
 *   Turf/Items + Snacks − Offer/Discount = GRAND TOTAL
 *   GRAND TOTAL − Advance/Paid           = Balance due
 * and that every printed total is self-consistent with the line items shown
 * directly above it — never silently trusting a stored field that could have
 * drifted from what's actually itemized on the page.
 */

function makeBooking(over: Partial<TurfBooking> = {}): TurfBooking {
  return {
    id: "b1",
    booking_no: "INV-20260101-0001",
    booking_date: "2026-01-01",
    customer_name: "Test Customer",
    phone: "9876543210",
    slot_name: "Weekdays",
    hours: 1,
    rate_per_hour: 1200,
    total_amount: 1200,
    advance_paid: 0,
    payment_mode: "Cash",
    status: "Confirmed",
    discount: 0,
    notes: null,
    start_time: "06:00 AM",
    end_time: "07:00 AM",
    courts: 1,
    snacks: [],
    snacks_total: 0,
    turf_amount: 1200,
    merged_into_bill_id: null,
    ...over,
  };
}

function getTotal(doc: ReturnType<typeof bookingReceipt>, label: string) {
  return doc.totals.find((t) => t.label === label)?.value;
}

function amountFor(value: string | undefined) {
  return Number((value ?? "").replace(/[^0-9.-]/g, ""));
}

describe("bookingReceipt() — turf booking invoices", () => {
  it("GRAND TOTAL is Turf minus Offer/Discount when nothing is paid", () => {
    const b = makeBooking({
      total_amount: 1100,
      turf_amount: 1200,
      discount: 100,
    });
    const doc = bookingReceipt(b);
    expect(amountFor(getTotal(doc, "Turf"))).toBe(1200);
    expect(amountFor(getTotal(doc, "Discount"))).toBe(-100);
    expect(amountFor(getTotal(doc, "GRAND TOTAL"))).toBe(1100);
  });

  it("Balance due is GRAND TOTAL minus Advance paid, never negative", () => {
    const b = makeBooking({
      total_amount: 1200,
      turf_amount: 1200,
      advance_paid: 500,
    });
    const doc = bookingReceipt(b);
    expect(amountFor(getTotal(doc, "Paid"))).toBe(500);
    expect(amountFor(getTotal(doc, "Balance due"))).toBe(700);
  });

  it("drops the 'Balance due' line entirely once advance covers the total", () => {
    const b = makeBooking({
      total_amount: 1200,
      turf_amount: 1200,
      advance_paid: 1200,
    });
    const doc = bookingReceipt(b);
    expect(getTotal(doc, "Balance due")).toBeUndefined();
  });

  it("never lets an over-payment show a negative balance due", () => {
    const b = makeBooking({
      total_amount: 1200,
      turf_amount: 1200,
      advance_paid: 1500,
    });
    const doc = bookingReceipt(b);
    expect(getTotal(doc, "Balance due")).toBeUndefined();
  });

  it("itemizes Offer/Discount and Advance paid as negative line entries", () => {
    const b = makeBooking({
      total_amount: 1000,
      turf_amount: 1200,
      discount: 200,
      advance_paid: 400,
    });
    const doc = bookingReceipt(b);
    const offerLine = doc.lines.find((l) => l.label === "Offer / Discount");
    const advanceLine = doc.lines.find((l) => l.label === "Advance paid");
    expect(offerLine?.amount).toBe(-200);
    expect(advanceLine?.amount).toBe(-400);
  });

  it("omits Offer/Discount and Advance paid lines entirely when zero", () => {
    const b = makeBooking({ discount: 0, advance_paid: 0 });
    const doc = bookingReceipt(b);
    expect(
      doc.lines.find((l) => l.label === "Offer / Discount"),
    ).toBeUndefined();
    expect(doc.lines.find((l) => l.label === "Advance paid")).toBeUndefined();
  });

  it("GRAND TOTAL folds in Snacks too, not just Turf minus Discount", () => {
    // Regression guard: GRAND TOTAL must always equal the Turf + Snacks −
    // Discount shown directly above it. `total_amount` is normally created
    // exactly this way, but if it were ever out of sync with `snacks_total`
    // (e.g. an older/imported row), the printed Grand Total would silently
    // disagree with its own Turf/Snacks/Discount lines — which is exactly
    // the class of bug this test locks down.
    const b = makeBooking({
      total_amount: 1200, // deliberately NOT pre-adjusted for snacks/discount
      turf_amount: 1200,
      snacks_total: 150,
      discount: 100,
      advance_paid: 0,
    });
    const doc = bookingReceipt(b);
    expect(amountFor(getTotal(doc, "Turf"))).toBe(1200);
    expect(amountFor(getTotal(doc, "Snacks"))).toBe(150);
    expect(amountFor(getTotal(doc, "Discount"))).toBe(-100);
    // 1200 + 150 - 100 = 1250, NOT the stale total_amount of 1200.
    expect(amountFor(getTotal(doc, "GRAND TOTAL"))).toBe(1250);
    expect(amountFor(getTotal(doc, "Balance due"))).toBe(1250);
  });

  it("omits the Snacks total line when there are no snack items", () => {
    const b = makeBooking({ snacks_total: 0 });
    const doc = bookingReceipt(b);
    expect(getTotal(doc, "Snacks")).toBeUndefined();
  });

  it("falls back to hours x rate x courts when turf_amount is missing", () => {
    const b = makeBooking({
      turf_amount: 0,
      hours: 2,
      rate_per_hour: 1200,
      courts: 2,
    });
    const doc = bookingReceipt(b);
    expect(amountFor(getTotal(doc, "Turf"))).toBe(4800);
  });

  it("carries Mode and Status through verbatim so a printout names them correctly", () => {
    const b = makeBooking({ payment_mode: "UPI", status: "Completed" });
    const doc = bookingReceipt(b);
    expect(getTotal(doc, "Mode")).toBe("UPI");
    expect(getTotal(doc, "Status")).toBe("Completed");
  });

  it("names the file after the booking number and customer", () => {
    const b = makeBooking({
      booking_no: "INV-20260304-0007",
      customer_name: "Arun Kumar",
    });
    const doc = bookingReceipt(b);
    expect(doc.fileName).toBe("INV-20260304-0007-Arun-Kumar");
  });
});

function makeBill(over: Partial<Bill> = {}): Bill {
  return {
    id: "bill1",
    invoice_no: "INV-20260101-0001",
    customer_name: "Test Customer",
    customer_phone: "9876543210",
    items: [
      { item: "Turf + snacks", rate: 1000, qty: 1, total: 1000, unit: "hr" },
    ],
    subtotal: 1000,
    discount: 0,
    total: 1000,
    amount_paid: 0,
    status: "unpaid",
    payment_mode: null,
    bill_date: "2026-01-01T06:00:00.000Z",
    ...over,
  };
}

describe("billReceipt() — merged/QuickPay bill invoices", () => {
  it("GRAND TOTAL is Subtotal minus Discount when tax is off", () => {
    const bill = makeBill({ subtotal: 1000, discount: 100, total: 900 });
    const doc = billReceipt(bill);
    expect(amountFor(getTotal(doc, "Subtotal"))).toBe(1000);
    expect(amountFor(getTotal(doc, "Discount"))).toBe(-100);
    expect(amountFor(getTotal(doc, "GRAND TOTAL"))).toBe(900);
  });

  it("a 'paid' bill shows Paid equal to the Grand Total and no balance due", () => {
    const bill = makeBill({
      subtotal: 1000,
      total: 1000,
      status: "paid",
      amount_paid: 0,
    });
    const doc = billReceipt(bill);
    expect(amountFor(getTotal(doc, "Paid"))).toBe(
      amountFor(getTotal(doc, "GRAND TOTAL")),
    );
    expect(getTotal(doc, "Balance due")).toBeUndefined();
  });

  it("a 'partial' bill's Balance due is Grand Total minus what was actually paid", () => {
    const bill = makeBill({
      subtotal: 2000,
      total: 2000,
      status: "partial",
      amount_paid: 500,
    });
    const doc = billReceipt(bill);
    expect(amountFor(getTotal(doc, "Paid"))).toBe(500);
    expect(amountFor(getTotal(doc, "Balance due"))).toBe(1500);
  });

  it("itemizes Offer/Discount and Advance paid as negative line entries", () => {
    const bill = makeBill({
      subtotal: 1000,
      discount: 150,
      total: 850,
      amount_paid: 850,
    });
    const doc = billReceipt(bill);
    const offerLine = doc.lines.find((l) => l.label === "Offer / Discount");
    expect(offerLine?.amount).toBe(-150);
  });

  it("shows the Status in upper case exactly as the app names it", () => {
    const bill = makeBill({ status: "unpaid" });
    expect(getTotal(billReceipt(bill), "Status")).toBe("UNPAID");
  });
});

describe("snackSaleReceipt() — snack-counter invoices", () => {
  const sale: SnackSale = {
    id: "s1",
    bill_no: "SB-20260101-0001",
    sale_date: "2026-01-01",
    customer_name: "Test Customer",
    items: [
      {
        item_name: "Frooti 200ml",
        qty: 2,
        unit_price: 25,
        cost_price: 16,
        amount: 50,
      },
      {
        item_name: "Lays Chips 52g",
        qty: 1,
        unit_price: 20,
        cost_price: 14,
        amount: 20,
      },
    ],
    total: 70,
    profit: 24,
    payment_mode: "Cash",
    notes: null,
    booking_id: null,
    booking_no: null,
    merged_into_bill_id: null,
  };

  it("GRAND TOTAL is the sum of every item's amount", () => {
    const doc = snackSaleReceipt(sale);
    const itemSum = sale.items.reduce((s, it) => s + it.amount, 0);
    expect(amountFor(getTotal(doc, "GRAND TOTAL"))).toBe(itemSum);
  });

  it("names the linked booking on the printout when one exists", () => {
    const linked = { ...sale, booking_no: "INV-20260101-0002" };
    const doc = snackSaleReceipt(linked);
    expect(getTotal(doc, "Linked booking")).toBe("INV-20260101-0002");
  });

  it("omits the linked-booking line for a standalone counter sale", () => {
    const doc = snackSaleReceipt(sale);
    expect(getTotal(doc, "Linked booking")).toBeUndefined();
  });
});

describe("receiptText() — WhatsApp/copy plain-text fallback", () => {
  it("carries every total line through as 'Label: value'", () => {
    const b = makeBooking({
      total_amount: 1200,
      turf_amount: 1200,
      advance_paid: 500,
    });
    const text = receiptText(bookingReceipt(b));
    expect(text).toContain("GRAND TOTAL: Rs 1,200");
    expect(text).toContain("Paid: Rs 500");
    expect(text).toContain("Balance due: Rs 700");
  });
});

/**
 * GST scope (Option B, documented in lib/settings.ts): when GST is on it
 * applies to Turf and Snacks receipts too, not only formal Bills — and the
 * rate is frozen on the record at creation, so these receipts print from the
 * snapshot and a later rate change can never move them.
 */
describe("tax on Turf and Snacks receipts", () => {
  const gst18 = (taxable: number) => ({
    tax_amount: Math.round(taxable * 0.18),
    tax_lines: [
      {
        label: "CGST @9%",
        value: Math.round(taxable * 0.18) - Math.floor(taxable * 0.09),
      },
      { label: "SGST @9%", value: Math.floor(taxable * 0.09) },
    ],
  });

  it("booking receipt prints Taxable Amount + tax lines and a tax-inclusive GRAND TOTAL", () => {
    const b = makeBooking({
      total_amount: 1000,
      turf_amount: 1000,
      ...gst18(1000),
    });
    const doc = bookingReceipt(b);
    expect(amountFor(getTotal(doc, "Taxable Amount"))).toBe(1000);
    const cgst = amountFor(getTotal(doc, "CGST @9%"));
    const sgst = amountFor(getTotal(doc, "SGST @9%"));
    expect(cgst).toBe(sgst); // hard GST-portal rule: the halves must be equal
    expect(cgst + sgst).toBe(180);
    expect(amountFor(getTotal(doc, "GRAND TOTAL"))).toBe(1180);
    expect(amountFor(getTotal(doc, "Balance due"))).toBe(1180);
  });

  it("booking balance due, and so the tab charge, is the tax-inclusive figure", () => {
    const b = makeBooking({
      total_amount: 1000,
      turf_amount: 1000,
      advance_paid: 400,
      ...gst18(1000),
    });
    expect(bookingDue(b)).toBe(780); // 1180 - 400, not 600
    expect(amountFor(getTotal(bookingReceipt(b), "Balance due"))).toBe(
      bookingDue(b),
    );
  });

  it("snacks receipt prints tax and its collected amount is tax-inclusive", () => {
    const s: SnackSale = {
      id: "s2",
      bill_no: "SB-20260101-0002",
      sale_date: "2026-01-01",
      customer_name: "Test Customer",
      items: [
        {
          item_name: "Frooti 200ml",
          qty: 8,
          unit_price: 25,
          cost_price: 16,
          amount: 200,
        },
      ],
      total: 200,
      profit: 72,
      payment_mode: "Cash",
      notes: null,
      booking_id: null,
      booking_no: null,
      merged_into_bill_id: null,
      ...gst18(200),
    };
    const doc = snackSaleReceipt(s);
    expect(amountFor(getTotal(doc, "Taxable Amount"))).toBe(200);
    expect(amountFor(getTotal(doc, "GRAND TOTAL"))).toBe(236);
    expect(snackSaleCollected(s)).toBe(236);
  });

  it("a reprint after a GST rate change is identical to the original", () => {
    const b = makeBooking({
      total_amount: 1000,
      turf_amount: 1000,
      ...gst18(1000),
    });
    const first = receiptText(bookingReceipt(b));
    // Rate changes only affect NEW records; this one carries its own snapshot.
    const reprint = receiptText(bookingReceipt(b));
    expect(reprint).toBe(first);
  });
});

/**
 * The GST switch in Settings, both ways.
 *
 * GST off  -> no Taxable Amount / CGST / SGST lines at all, and Grand Total,
 *             Balance due and the tab charge are the plain post-discount total.
 * GST on   -> tax added on every document type.
 * Either way the switch only affects documents created AFTER it is flipped:
 * each record carries its own frozen figures, so flipping the switch (or the
 * rate) later cannot move an already-issued receipt or its reprint.
 */
describe("GST toggle — off vs on", () => {
  const gstOff = { gstEnabled: false, gstRate: 18, customTaxes: [] };
  const gstOn = { gstEnabled: true, gstRate: 18, customTaxes: [] };

  /** Pretend Settings currently has GST switched on (live fallback path). */
  function withLiveGstOn<T>(fn: () => T): T {
    const store = new Map([["ks:app-settings", JSON.stringify(gstOn)]]);
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: (k: string) => store.get(k) ?? null },
    };
    try {
      return fn();
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  }

  it("GST off: freezes zero tax, prints no tax lines, totals stay pre-tax", () => {
    const snap = freezeTax(1000, gstOff);
    expect(snap.taxAmount).toBe(0);
    expect(snap.taxLines).toEqual([]);
    expect(snap.gross).toBe(1000);

    const b = makeBooking({
      total_amount: 1000,
      turf_amount: 1000,
      advance_paid: 400,
      tax_amount: snap.taxAmount,
      tax_lines: snap.taxLines,
    });
    const doc = bookingReceipt(b);
    expect(getTotal(doc, "Taxable Amount")).toBeUndefined();
    expect(getTotal(doc, "CGST @9%")).toBeUndefined();
    expect(amountFor(getTotal(doc, "GRAND TOTAL"))).toBe(1000);
    expect(amountFor(getTotal(doc, "Balance due"))).toBe(600);
    expect(bookingDue(b)).toBe(600);
  });

  it("GST on: same booking is taxed, and the balance the tab gets is the taxed one", () => {
    const snap = freezeTax(1000, gstOn);
    expect(snap.taxAmount).toBe(180);
    expect(snap.gross).toBe(1180);

    const b = makeBooking({
      total_amount: 1000,
      turf_amount: 1000,
      advance_paid: 400,
      tax_amount: snap.taxAmount,
      tax_lines: snap.taxLines,
    });
    expect(amountFor(getTotal(bookingReceipt(b), "GRAND TOTAL"))).toBe(1180);
    expect(bookingDue(b)).toBe(780);
  });

  it("switching GST on later does NOT move a booking made while it was off", () => {
    const off = freezeTax(1000, gstOff);
    const b = makeBooking({
      total_amount: 1000,
      turf_amount: 1000,
      tax_amount: off.taxAmount,
      tax_lines: off.taxLines,
    });
    const before = receiptText(bookingReceipt(b));
    const after = withLiveGstOn(() => receiptText(bookingReceipt(b)));
    expect(after).toBe(before);
    expect(withLiveGstOn(() => bookingDue(b))).toBe(1000);
  });

  it("switching GST off later does NOT untax a booking made while it was on", () => {
    const on = freezeTax(1000, gstOn);
    const b = makeBooking({
      total_amount: 1000,
      turf_amount: 1000,
      tax_amount: on.taxAmount,
      tax_lines: on.taxLines,
    });
    // Ambient settings here have GST off (test env default) — the snapshot wins.
    expect(amountFor(getTotal(bookingReceipt(b), "GRAND TOTAL"))).toBe(1180);
    expect(bookingDue(b)).toBe(1180);
  });

  it("legacy rows with no snapshot follow the live switch (documented limitation)", () => {
    const legacy = makeBooking({ total_amount: 1000, turf_amount: 1000 });
    expect(amountFor(getTotal(bookingReceipt(legacy), "GRAND TOTAL"))).toBe(
      1000,
    );
    expect(
      withLiveGstOn(() =>
        amountFor(getTotal(bookingReceipt(legacy), "GRAND TOTAL")),
      ),
    ).toBe(1180);
  });
});
