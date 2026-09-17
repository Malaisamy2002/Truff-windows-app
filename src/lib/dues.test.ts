import { describe, expect, it } from "vitest";

import {
  billCollected,
  billDue,
  billMovedToDues,
  bookingCashCollected,
  bookingDue,
  bookingMovedToDues,
  bookingStateLabel,
  customerOutstanding,
  dueNoFor,
  dueNoForRef,
  groupTabLedger,
  isFinancialBooking,
  isFinancialSale,
  netTabAmountFor,
  saleMovedToDues,
  saleStateLabel,
  snackSaleCollected,
} from "./dues";
import type { Bill } from "./biz";
import type { SnackSale, TurfBooking } from "./ops";
import {
  TAB_REF_BILL,
  TAB_REF_MERGE_REVERSE,
  TAB_REF_SNACK_SALE,
  TAB_REF_TURF_BOOKING,
  tabKey,
  type TabEntry,
} from "./tabs";

const CUSTOMER = { name: "Ravi", phone: "9876543210" };
const KEY = tabKey(CUSTOMER.name, CUSTOMER.phone);

function bill(over: Partial<Bill> = {}): Bill {
  return {
    id: "b1",
    invoice_no: "INV-1",
    customer_name: CUSTOMER.name,
    customer_phone: CUSTOMER.phone,
    items: [],
    subtotal: 1000,
    discount: 0,
    total: 1000,
    amount_paid: 0,
    status: "unpaid",
    payment_mode: "Cash",
    bill_date: "2026-09-01",
    ...over,
  } as Bill;
}

function booking(over: Partial<TurfBooking> = {}): TurfBooking {
  return {
    id: "k1",
    booking_no: "B-1",
    booking_date: "2026-09-01",
    customer_name: CUSTOMER.name,
    phone: CUSTOMER.phone,
    slot_name: "Evening",
    hours: 1,
    rate_per_hour: 800,
    total_amount: 800,
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
    turf_amount: 800,
    merged_into_bill_id: null,
    ...over,
  };
}

function sale(over: Partial<SnackSale> = {}): SnackSale {
  return {
    id: "s1",
    bill_no: "S-1",
    sale_date: "2026-09-01",
    customer_name: CUSTOMER.name,
    items: [],
    total: 200,
    profit: 60,
    payment_mode: "Cash",
    notes: null,
    merged_into_bill_id: null,
    ...over,
  };
}

function entry(over: Partial<TabEntry> = {}): TabEntry {
  return {
    id: `e${Math.random()}`,
    tab_id: "t1",
    customer_key: KEY,
    kind: "charge",
    business: "Turf",
    amount: 100,
    note: null,
    ref_type: null,
    ref_id: null,
    entry_date: "2026-09-01",
    created_at: "2026-09-01T00:00:00.000Z",
    ...over,
  } as TabEntry;
}

describe("netTabAmountFor", () => {
  it("nets charges against payments for the same source", () => {
    const entries = [
      entry({ ref_type: TAB_REF_TURF_BOOKING, ref_id: "k1", amount: 500 }),
      entry({
        ref_type: TAB_REF_TURF_BOOKING,
        ref_id: "k1",
        kind: "payment",
        amount: 200,
      }),
      entry({ ref_type: TAB_REF_TURF_BOOKING, ref_id: "other", amount: 999 }),
    ];
    expect(netTabAmountFor(entries, TAB_REF_TURF_BOOKING, "k1")).toBe(300);
  });

  it("never goes negative and ignores a missing ref", () => {
    const entries = [
      entry({
        ref_type: TAB_REF_BILL,
        ref_id: "b1",
        kind: "payment",
        amount: 700,
      }),
    ];
    expect(netTabAmountFor(entries, TAB_REF_BILL, "b1")).toBe(0);
    expect(netTabAmountFor(entries, TAB_REF_BILL, null)).toBe(0);
  });
});

describe("financial-record guards", () => {
  it("excludes cancelled, no-show, and merged bookings, and merged sales", () => {
    expect(isFinancialBooking(booking())).toBe(true);
    expect(isFinancialBooking(booking({ status: "Cancelled" }))).toBe(false);
    expect(isFinancialBooking(booking({ status: "No-show" }))).toBe(false);
    expect(isFinancialBooking(booking({ merged_into_bill_id: "b1" }))).toBe(
      false,
    );
    expect(isFinancialSale(sale())).toBe(true);
    expect(isFinancialSale(sale({ merged_into_bill_id: "b1" }))).toBe(false);
    expect(isFinancialSale(sale({ cancelled: true }))).toBe(false);
  });
});

describe("bookingDue", () => {
  it("is total minus advance", () => {
    expect(bookingDue(booking({ advance_paid: 300 }))).toBe(500);
  });

  it("drops to 0 once the balance is on the tab", () => {
    const entries = [
      entry({ ref_type: TAB_REF_TURF_BOOKING, ref_id: "k1", amount: 800 }),
    ];
    expect(bookingDue(booking(), entries)).toBe(0);
  });

  it("is 0 for merged, cancelled, and no-show bookings", () => {
    expect(bookingDue(booking({ merged_into_bill_id: "b9" }))).toBe(0);
    expect(bookingDue(booking({ status: "Cancelled" }))).toBe(0);
    expect(bookingDue(booking({ status: "No-show" }))).toBe(0);
  });
});

describe("billDue / billCollected", () => {
  it("owes the unpaid balance on a normal bill", () => {
    expect(billDue(bill({ amount_paid: 400 }))).toBe(600);
  });

  it("owes nothing on an 'On tab' bill (the tab owns it)", () => {
    const onTab = bill({ payment_mode: "On tab", amount_paid: 300 });
    expect(billDue(onTab)).toBe(0);
    expect(billCollected(onTab)).toBe(300);
  });

  it("subtracts an amount separately pushed onto the tab", () => {
    const entries = [
      entry({ ref_type: TAB_REF_BILL, ref_id: "b1", amount: 250 }),
    ];
    expect(billDue(bill({ amount_paid: 400 }), entries)).toBe(350);
  });

  it("counts a paid bill as fully collected", () => {
    expect(billCollected(bill({ status: "paid", amount_paid: 0 }))).toBe(1000);
  });

  it("a cancelled bill owes nothing and collects nothing, even with a stale amount_paid", () => {
    const voided = bill({ status: "cancelled", amount_paid: 400 });
    expect(billDue(voided)).toBe(0);
    expect(billCollected(voided)).toBe(0);
    expect(billMovedToDues(voided)).toBe(false);
  });

  it("a cancelled bill still owes nothing even with money separately on the tab", () => {
    const entries = [
      entry({ ref_type: TAB_REF_BILL, ref_id: "b1", amount: 250 }),
    ];
    expect(
      billDue(bill({ status: "cancelled", amount_paid: 400 }), entries),
    ).toBe(0);
  });
});

describe("snack sales", () => {
  it("collects nothing for an 'On tab' sale", () => {
    expect(snackSaleCollected(sale())).toBe(200);
    expect(snackSaleCollected(sale({ payment_mode: "On tab" }))).toBe(0);
  });

  it("a cancelled sale collects nothing, even with a stale non-tab payment_mode", () => {
    expect(
      snackSaleCollected(sale({ cancelled: true, payment_mode: "Cash" })),
    ).toBe(0);
  });

  it("labels tab, merged, and cancelled state — cancelled wins over a stale payment_mode", () => {
    expect(saleStateLabel(sale())).toBeNull();
    expect(saleStateLabel(sale({ payment_mode: "On tab" }))).toBe("On tab");
    expect(saleStateLabel(sale({ merged_into_bill_id: "b1" }), "INV-9")).toBe(
      "Merged into INV-9",
    );
    expect(saleStateLabel(sale({ cancelled: true }))).toBe("Cancelled");
    expect(
      saleStateLabel(sale({ cancelled: true, payment_mode: "On tab" })),
    ).toBe("Cancelled");
    const entries = [
      entry({ ref_type: TAB_REF_TURF_BOOKING, ref_id: "k1", amount: 800 }),
    ];
    expect(bookingStateLabel(booking(), entries)).toBe("On tab");
    expect(
      bookingStateLabel(booking({ merged_into_bill_id: "b1" }), [], "INV-9"),
    ).toBe("Merged into INV-9");
  });
});

describe("customerOutstanding", () => {
  it("adds tab, booking and bill dues with one line each", () => {
    const entries = [entry({ amount: 150, note: "Manual due" })];
    const dues = customerOutstanding(CUSTOMER, {
      bills: [bill({ amount_paid: 400 })],
      bookings: [booking({ advance_paid: 300 })],
      tabEntries: entries,
    });
    expect(dues.tab).toBe(150);
    expect(dues.bookings).toBe(500);
    expect(dues.bills).toBe(600);
    expect(dues.total).toBe(1250);
    expect(dues.lines.map((l) => l.kind)).toEqual(["tab", "booking", "bill"]);
  });

  it("ignores other customers' records", () => {
    const dues = customerOutstanding(CUSTOMER, {
      bills: [bill({ customer_name: "Other", customer_phone: "9000000000" })],
      bookings: [booking({ customer_name: "Other", phone: "9000000000" })],
    });
    expect(dues.total).toBe(0);
  });

  it("honours a custom name matcher when a record has no phone", () => {
    const noPhone = bill({ customer_phone: null, amount_paid: 0 });
    expect(customerOutstanding(CUSTOMER, { bills: [noPhone] }).total).toBe(0);
    expect(
      customerOutstanding(CUSTOMER, {
        bills: [noPhone],
        match: (n) => (n ?? "").toLowerCase() === "ravi",
      }).total,
    ).toBe(1000);
  });
});

describe("due numbers", () => {
  it("builds D-<moved date DDMMYY>-<original no>", () => {
    expect(dueNoFor("INV-0007", "2026-09-05")).toBe("D-050926-INV-0007");
  });

  it("uses the earliest tab charge as the move date, else the record date", () => {
    const entries = [
      entry({
        ref_type: TAB_REF_BILL,
        ref_id: "b1",
        amount: 500,
        entry_date: "2026-09-05",
      }),
      entry({
        ref_type: TAB_REF_BILL,
        ref_id: "b1",
        amount: 100,
        entry_date: "2026-09-03",
      }),
    ];
    expect(
      dueNoForRef(entries, TAB_REF_BILL, "b1", "INV-1", "2026-09-01"),
    ).toBe("D-030926-INV-1");
    // No charge against the record → falls back to the record's own date.
    expect(dueNoForRef([], TAB_REF_BILL, "b1", "INV-1", "2026-09-01")).toBe(
      "D-010926-INV-1",
    );
  });

  it("marks a bill whose balance sits on the tab as moved to dues", () => {
    expect(billMovedToDues(bill({ amount_paid: 400 }))).toBe(false);
    expect(
      billMovedToDues(bill({ payment_mode: "On tab", amount_paid: 300 })),
    ).toBe(true);
    const entries = [
      entry({ ref_type: TAB_REF_BILL, ref_id: "b1", amount: 1000 }),
    ];
    expect(billMovedToDues(bill(), entries)).toBe(true);
    expect(billMovedToDues(bill({ status: "paid", amount_paid: 1000 }))).toBe(
      false,
    );
  });
});

describe("groupTabLedger", () => {
  it("names one line per source record and nets payments", () => {
    const entries = [
      entry({ ref_type: TAB_REF_TURF_BOOKING, ref_id: "k1", amount: 800 }),
      entry({
        ref_type: TAB_REF_TURF_BOOKING,
        ref_id: "k1",
        kind: "payment",
        amount: 300,
      }),
      entry({
        ref_type: TAB_REF_SNACK_SALE,
        ref_id: "s1",
        amount: 200,
        business: "Snacks",
      }),
      entry({ amount: 100, note: "Ball damage" }),
    ];
    const groups = groupTabLedger(entries, {
      bookings: [booking()],
      sales: [sale()],
      bills: [bill()],
    });
    const byLabel = Object.fromEntries(groups.map((g) => [g.label, g.net]));
    expect(byLabel["Booking B-1"]).toBe(500);
    expect(byLabel["Snack bill S-1"]).toBe(200);
    expect(byLabel["Manual dues"]).toBe(100);
  });

  it("stamps record-backed lines with a due number; free lines get none", () => {
    const entries = [
      entry({
        ref_type: TAB_REF_TURF_BOOKING,
        ref_id: "k1",
        amount: 800,
        entry_date: "2026-09-05",
      }),
      entry({ amount: 100, note: "Ball damage" }),
    ];
    const groups = groupTabLedger(entries, { bookings: [booking()] });
    const bookingGroup = groups.find((g) => g.refType === TAB_REF_TURF_BOOKING);
    expect(bookingGroup?.dueNo).toBe("D-050926-B-1");
    expect(groups.find((g) => g.refType === null)?.dueNo).toBeNull();
  });

  it("nets a merge reversal against the source it cancels", () => {
    const entries = [
      entry({ ref_type: TAB_REF_SNACK_SALE, ref_id: "s1", amount: 200 }),
      entry({
        ref_type: TAB_REF_MERGE_REVERSE,
        ref_id: "rev1",
        kind: "payment",
        amount: 200,
        source_ref_type: TAB_REF_SNACK_SALE,
        source_ref_id: "s1",
      }),
    ];
    const groups = groupTabLedger(entries, { sales: [sale()] });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.net).toBe(0);
  });
});

describe("invariant: every rupee is owed exactly once", () => {
  it("a merged bill moves the due off the source records and off the tab", () => {
    // Before: a booking on the tab plus a snack sale on the tab.
    const before: TabEntry[] = [
      entry({ ref_type: TAB_REF_TURF_BOOKING, ref_id: "k1", amount: 800 }),
      entry({
        ref_type: TAB_REF_SNACK_SALE,
        ref_id: "s1",
        amount: 200,
        business: "Snacks",
      }),
    ];
    const beforeDues = customerOutstanding(CUSTOMER, {
      bills: [],
      bookings: [booking()],
      tabEntries: before,
    });
    expect(beforeDues.total).toBe(1000);

    // After merging both into one unpaid bill: charges reversed, sources merged.
    const after: TabEntry[] = [
      ...before,
      entry({
        ref_type: TAB_REF_MERGE_REVERSE,
        kind: "payment",
        amount: 800,
        source_ref_type: TAB_REF_TURF_BOOKING,
        source_ref_id: "k1",
      }),
      entry({
        ref_type: TAB_REF_MERGE_REVERSE,
        kind: "payment",
        amount: 200,
        source_ref_type: TAB_REF_SNACK_SALE,
        source_ref_id: "s1",
      }),
    ];
    const merged = bill({
      id: "b2",
      invoice_no: "INV-2",
      total: 1000,
      subtotal: 1000,
    });
    const afterDues = customerOutstanding(CUSTOMER, {
      bills: [merged],
      bookings: [booking({ merged_into_bill_id: "b2" })],
      tabEntries: after,
    });

    // Same total, now owed once — on the bill.
    expect(afterDues.total).toBe(1000);
    expect(afterDues.tab).toBe(0);
    expect(afterDues.bookings).toBe(0);
    expect(afterDues.bills).toBe(1000);
    expect(afterDues.lines).toHaveLength(1);
  });

  it("collecting on the tab never leaves a negative due", () => {
    const entries = [
      entry({ ref_type: TAB_REF_TURF_BOOKING, ref_id: "k1", amount: 800 }),
      entry({ kind: "payment", amount: 1200 }),
    ];
    const dues = customerOutstanding(CUSTOMER, {
      bookings: [booking()],
      tabEntries: entries,
    });
    expect(dues.tab).toBe(0);
    expect(dues.bookings).toBe(0);
    expect(dues.total).toBe(0);
  });
});

describe("bookingCashCollected", () => {
  it("is the advance when nothing moved onto the tab", () => {
    expect(bookingCashCollected(booking({ advance_paid: 300 }))).toBe(300);
  });

  it("strips out a balance parked on the tab (no double count)", () => {
    // "Put balance on tab" writes advance_paid = gross AND posts the
    // remainder as a tab charge. Real cash taken was only ₹300.
    const entries = [
      entry({ ref_type: TAB_REF_TURF_BOOKING, ref_id: "k1", amount: 500 }),
    ];
    expect(bookingCashCollected(booking({ advance_paid: 800 }), entries)).toBe(
      300,
    );
  });

  it("stays net of the tab while a real dues payment is recorded", () => {
    // A Dues-tab collection carries NO ref_type (isTabCashPayment), so it is
    // counted once as tab cash and never re-credited to the booking.
    const entries = [
      entry({ ref_type: TAB_REF_TURF_BOOKING, ref_id: "k1", amount: 500 }),
      entry({ kind: "payment", amount: 500 }),
    ];
    expect(bookingCashCollected(booking({ advance_paid: 800 }), entries)).toBe(
      300,
    );
  });

  it("gives the charge back when a bookkeeping reversal pulls it off the tab", () => {
    // A reversal (merge/un-merge) is a payment row WITH a ref_type: no cash
    // moved, the tab no longer owns the balance, so the booking owns it again.
    const entries = [
      entry({ ref_type: TAB_REF_TURF_BOOKING, ref_id: "k1", amount: 500 }),
      entry({
        ref_type: TAB_REF_TURF_BOOKING,
        ref_id: "k1",
        kind: "payment",
        amount: 500,
      }),
    ];
    expect(bookingCashCollected(booking({ advance_paid: 800 }), entries)).toBe(
      800,
    );
  });

  it("never goes negative", () => {
    const entries = [
      entry({ ref_type: TAB_REF_TURF_BOOKING, ref_id: "k1", amount: 900 }),
    ];
    expect(bookingCashCollected(booking({ advance_paid: 800 }), entries)).toBe(
      0,
    );
  });

  it("ignores tab activity belonging to another booking", () => {
    const entries = [
      entry({ ref_type: TAB_REF_TURF_BOOKING, ref_id: "other", amount: 500 }),
    ];
    expect(bookingCashCollected(booking({ advance_paid: 800 }), entries)).toBe(
      800,
    );
  });
});

describe("bookingMovedToDues / saleMovedToDues", () => {
  it("flags a booking whose balance sits on the tab", () => {
    const entries = [
      entry({ ref_type: TAB_REF_TURF_BOOKING, ref_id: "k1", amount: 500 }),
    ];
    expect(bookingMovedToDues(booking(), entries)).toBe(true);
    expect(bookingMovedToDues(booking())).toBe(false);
  });

  it("does not flag a merged booking, or one whose tab charge is settled", () => {
    const entries = [
      entry({ ref_type: TAB_REF_TURF_BOOKING, ref_id: "k1", amount: 500 }),
    ];
    expect(
      bookingMovedToDues(booking({ merged_into_bill_id: "b9" }), entries),
    ).toBe(false);
    expect(
      bookingMovedToDues(booking(), [
        ...entries,
        entry({
          ref_type: TAB_REF_TURF_BOOKING,
          ref_id: "k1",
          kind: "payment",
          amount: 500,
        }),
      ]),
    ).toBe(false);
  });

  it("flags an 'On tab' snack sale and one charged to the tab", () => {
    expect(saleMovedToDues(sale({ payment_mode: "On tab" }))).toBe(true);
    expect(
      saleMovedToDues(sale(), [
        entry({ ref_type: TAB_REF_SNACK_SALE, ref_id: "s1", amount: 200 }),
      ]),
    ).toBe(true);
    expect(saleMovedToDues(sale())).toBe(false);
    expect(
      saleMovedToDues(
        sale({ payment_mode: "On tab", merged_into_bill_id: "b9" }),
      ),
    ).toBe(false);
  });
});
