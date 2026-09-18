import { describe, expect, it } from "vitest";

import {
  ageBucket,
  clockMinutes,
  customerRanking,
  dataDateRange,
  dayKey,
  duesAgeing,
  itemPerformance,
  monthKey,
  monthsBetween,
  paymentSplit,
  periodStats,
  taxReport,
  turfOccupancy,
  type RankableCustomer,
  type Sources,
} from "./analytics";
import type { Bill } from "./biz";
import type { ExpenseV2, SnackSale, TurfBooking } from "./ops";
import { TAB_PAYMENT_MODE } from "./ops";
import { TAB_REF_BILL, type TabEntry } from "./tabs";
import type { AppSettings } from "./settings";
import { DEFAULT_APP_SETTINGS } from "./settings";

const DATE = "2026-09-01";
const matches = () => true;
const settings = (over: Partial<AppSettings> = {}): AppSettings => ({
  ...DEFAULT_APP_SETTINGS,
  ...over,
});

const bill = (over: Partial<Bill> = {}): Bill =>
  ({
    id: "b1",
    invoice_no: "INV-1",
    customer_name: "Ravi",
    customer_phone: "9876543210",
    items: [],
    subtotal: 1000,
    discount: 0,
    total: 1000,
    amount_paid: 0,
    status: "unpaid",
    payment_mode: "Cash",
    bill_date: DATE,
    ...over,
  }) as Bill;

const booking = (over: Partial<TurfBooking> = {}): TurfBooking =>
  ({
    id: "k1",
    booking_no: "B-1",
    customer_name: "Ravi",
    phone: "9876543210",
    booking_date: DATE,
    total_amount: 1000,
    advance_paid: 0,
    status: "Booked",
    payment_mode: "Cash",
    merged_into_bill_id: null,
    ...over,
  }) as unknown as TurfBooking;

const sale = (over: Partial<SnackSale> = {}): SnackSale =>
  ({
    id: "s1",
    bill_no: "S-1",
    sale_date: DATE,
    total: 500,
    profit: 200,
    payment_mode: "Cash",
    merged_into_bill_id: null,
    ...over,
  }) as unknown as SnackSale;

const expense = (over: Partial<ExpenseV2> = {}): ExpenseV2 =>
  ({
    id: "e1",
    category: "ingredients",
    note: null,
    amount: 300,
    spent_at: DATE,
    ...over,
  }) as unknown as ExpenseV2;

const entry = (over: Partial<TabEntry>): TabEntry =>
  ({
    id: Math.random().toString(36).slice(2),
    tab_id: "t1",
    customer_key: "p:9876543210",
    kind: "charge",
    business: "Shared",
    amount: 0,
    note: null,
    ref_type: null,
    ref_id: null,
    source_ref_type: null,
    source_ref_id: null,
    entry_date: DATE,
    created_at: `${DATE}T00:00:00.000Z`,
    ...over,
  }) as TabEntry;

const src = (over: Partial<Sources> = {}): Sources => ({
  bills: [],
  bookings: [],
  sales: [],
  expenses: [],
  tabEntries: [],
  ...over,
});

describe("monthsBetween()", () => {
  it("spans a range inclusive of both endpoints", () => {
    expect(monthsBetween("2026-01", "2026-04")).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
  });

  it("returns a single key when start and end are the same month", () => {
    expect(monthsBetween("2026-06", "2026-06")).toEqual(["2026-06"]);
  });

  it("crosses a year boundary", () => {
    expect(monthsBetween("2025-11", "2026-02")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("returns an empty array when end is before start rather than counting backwards", () => {
    expect(monthsBetween("2026-06", "2026-01")).toEqual([]);
  });
});

describe("dataDateRange()", () => {
  it("returns null when there is no data at all", () => {
    expect(dataDateRange(src())).toBeNull();
  });

  it("finds the earliest and latest date across every source table", () => {
    const range = dataDateRange(
      src({
        bills: [bill({ bill_date: "2026-03-15T10:00:00.000Z" })],
        bookings: [booking({ booking_date: "2025-11-02" })],
        sales: [sale({ sale_date: "2026-06-20" })],
        expenses: [expense({ spent_at: "2026-01-05" })],
      }),
    );
    expect(range).toEqual({ earliest: "2025-11-02", latest: "2026-06-20" });
  });

  it("reads bill_date as a full IST timestamp, not a UTC slice", () => {
    // 2026-01-01T19:00:00Z is 2026-01-02 00:30 IST — the plain-date
    // fast-path in dayKey() must not apply here (bill_date isn't a bare
    // "YYYY-MM-DD" string), so this should land on the IST calendar date.
    const range = dataDateRange(
      src({ bills: [bill({ bill_date: "2026-01-01T19:00:00.000Z" })] }),
    );
    expect(range).toEqual({ earliest: "2026-01-02", latest: "2026-01-02" });
  });
});

describe("periodStats() revenue", () => {
  it("revenue = netRevenue + tax, and lines add up to netRevenue", () => {
    const s = periodStats(
      src({ bills: [bill()], bookings: [booking()], sales: [sale()] }),
      matches,
      settings({ gstEnabled: true, gstRate: 18 }),
    );
    expect(s.netRevenue).toBe(s.billsRevenue + s.turfRevenue + s.snacksRevenue);
    expect(s.revenue).toBe(s.netRevenue + s.tax);
    expect(s.tax).toBe(450);
    expect(s.revenue).toBe(2950);
  });

  it("profit ignores tax so switching GST on never inflates it", () => {
    const source = src({ bills: [bill()], expenses: [expense()] });
    const off = periodStats(source, matches, settings());
    const on = periodStats(
      source,
      matches,
      settings({ gstEnabled: true, gstRate: 18 }),
    );
    expect(off.profit).toBe(700);
    expect(on.profit).toBe(off.profit);
    expect(on.revenue).toBeGreaterThan(off.revenue);
  });

  it("taxes the post-discount total, not the subtotal", () => {
    const s = periodStats(
      src({ bills: [bill({ subtotal: 1000, discount: 200, total: 800 })] }),
      matches,
      settings({ gstEnabled: true, gstRate: 18 }),
    );
    expect(s.billsRevenue).toBe(800);
    expect(s.tax).toBe(144);
    expect(s.revenue).toBe(944);
  });

  it("a cancelled bill contributes nothing to revenue, tax, or collected — it's a void, not a discount", () => {
    const withCancelled = periodStats(
      src({
        bills: [
          bill(),
          bill({ id: "b2", status: "cancelled", amount_paid: 1000 }),
        ],
      }),
      matches,
      settings({ gstEnabled: true, gstRate: 18 }),
    );
    const withoutCancelled = periodStats(
      src({ bills: [bill()] }),
      matches,
      settings({ gstEnabled: true, gstRate: 18 }),
    );
    expect(withCancelled.billsRevenue).toBe(withoutCancelled.billsRevenue);
    expect(withCancelled.billsCollected).toBe(withoutCancelled.billsCollected);
    expect(withCancelled.tax).toBe(withoutCancelled.tax);
    expect(withCancelled.billsDues).toBe(withoutCancelled.billsDues);
  });

  it("includes a taxed booking's and a taxed snack sale's own frozen tax, not just bills' (regression: previously invisible on Dashboard/Reports/GST report)", () => {
    // Frozen tax_amount as ops.ts would have saved it at creation time (GST
    // on, 18%) — independent of whatever appSettings the aggregation call
    // happens to run with, exactly like a bill's own frozen tax.
    const taxedBooking = booking({
      total_amount: 1000,
      tax_amount: 180,
      advance_paid: 1180,
    });
    const taxedSale = sale({
      total: 500,
      tax_amount: 90,
      payment_mode: "Cash",
    });
    const s = periodStats(
      src({ bookings: [taxedBooking], sales: [taxedSale] }),
      matches,
      settings(), // GST off in current settings — the frozen amounts must still count
    );
    expect(s.turfRevenue).toBe(1000); // pre-tax, unchanged
    expect(s.snacksRevenue).toBe(500); // pre-tax, unchanged
    expect(s.tax).toBe(270); // 180 (booking) + 90 (sale) — used to be 0
    expect(s.netRevenue).toBe(1500);
    expect(s.revenue).toBe(1770); // netRevenue + tax
    // collected was already tax-inclusive before this fix; now it reconciles
    // with revenue + tax instead of appearing to exceed it (fully paid here,
    // so collected == revenue exactly).
    expect(s.collected).toBe(1180 + 590);
    expect(s.collected).toBe(s.revenue);
  });

  it("taxReport() includes booking/snack tax in taxableValue and totalTax (GST filing figures)", () => {
    const taxedBooking = booking({
      total_amount: 1000,
      tax_amount: 180,
      advance_paid: 1180,
    });
    const taxedSale = sale({ total: 500, tax_amount: 90 });
    const rows = taxReport(
      src({ bookings: [taxedBooking], sales: [taxedSale] }),
      ["2026-09"],
      settings(),
    );
    const [row] = rows;
    if (!row) throw new Error("expected a taxReport row");
    expect(row.taxableValue).toBe(1500); // netRevenue: pre-tax turf + snacks
    expect(row.totalTax).toBe(270); // used to be 0 — GST filing was understating this
    expect(row.grossValue).toBe(1770);
  });

  it("rounds every line to whole rupees", () => {
    const s = periodStats(
      src({
        bills: [bill({ total: 999.5 })],
        bookings: [booking({ total_amount: 250.4, advance_paid: 100.5 })],
        sales: [sale({ total: 49.5 })],
        expenses: [expense({ amount: 10.4 })],
      }),
      matches,
      settings(),
    );
    for (const v of [
      s.billsRevenue,
      s.turfRevenue,
      s.snacksRevenue,
      s.collected,
      s.expenses,
      s.dues,
      s.revenue,
    ])
      expect(Number.isInteger(v)).toBe(true);
    expect(s.billsRevenue).toBe(1000);
    expect(s.turfRevenue).toBe(250);
    expect(s.expenses).toBe(10);
  });
});

describe("periodStats() collected", () => {
  it("never counts an 'On tab' snack sale as collected", () => {
    const s = periodStats(
      src({ sales: [sale({ payment_mode: TAB_PAYMENT_MODE })] }),
      matches,
      settings(),
    );
    expect(s.snacksRevenue).toBe(500);
    expect(s.collected).toBe(0);
  });

  it("counts an 'On tab' bill only for what its sources actually collected", () => {
    const s = periodStats(
      src({
        bills: [
          bill({
            payment_mode: TAB_PAYMENT_MODE,
            amount_paid: 300,
            status: "partial",
          }),
        ],
      }),
      matches,
      settings(),
    );
    expect(s.collected).toBe(300);
    // The remaining ₹700 is owned by the tab ledger, so it isn't a bill due.
    expect(s.dues).toBe(0);
  });

  it("counts a paid bill's full gross total, tax included", () => {
    const s = periodStats(
      src({ bills: [bill({ status: "paid", amount_paid: 1000 })] }),
      matches,
      settings({ gstEnabled: true, gstRate: 18 }),
    );
    expect(s.collected).toBe(1180);
    expect(s.dues).toBe(0);
  });

  it("counts turf advances, not the whole booking", () => {
    const s = periodStats(
      src({ bookings: [booking({ total_amount: 1000, advance_paid: 400 })] }),
      matches,
      settings(),
    );
    expect(s.turfRevenue).toBe(1000);
    expect(s.collected).toBe(400);
    expect(s.dues).toBe(600);
  });
});

describe("periodStats() dues", () => {
  it("never double-counts money the tab ledger already owns", () => {
    const b = bill({ amount_paid: 0 });
    const withTab = periodStats(
      src({
        bills: [b],
        tabEntries: [
          entry({
            kind: "charge",
            amount: 1000,
            ref_type: TAB_REF_BILL,
            ref_id: b.id,
          }),
        ],
      }),
      matches,
      settings(),
    );
    expect(withTab.dues).toBe(0);

    const withoutTab = periodStats(src({ bills: [b] }), matches, settings());
    expect(withoutTab.dues).toBe(1000);
  });

  it("subtracts only the part of a booking that moved onto the tab", () => {
    const k = booking({ total_amount: 1000, advance_paid: 200 });
    const s = periodStats(
      src({
        bookings: [k],
        tabEntries: [
          entry({
            kind: "charge",
            amount: 500,
            ref_type: "turf_booking",
            ref_id: k.id,
          }),
        ],
      }),
      matches,
      settings(),
    );
    expect(s.dues).toBe(300);
  });

  it("excludes cancelled and merged records from every figure", () => {
    const s = periodStats(
      src({
        bookings: [
          booking({ id: "x1", status: "Cancelled" }),
          booking({ id: "x2", merged_into_bill_id: "bill9" }),
        ],
        sales: [sale({ id: "y1", merged_into_bill_id: "bill9" })],
      }),
      matches,
      settings(),
    );
    expect(s.turfRevenue).toBe(0);
    expect(s.snacksRevenue).toBe(0);
    expect(s.collected).toBe(0);
    expect(s.dues).toBe(0);
  });

  it("excludes a voided (cancelled) snack sale from revenue and collected, same as a merged one", () => {
    const s = periodStats(
      src({ sales: [sale({ id: "y2", cancelled: true, total: 300 })] }),
      matches,
      settings(),
    );
    expect(s.snacksRevenue).toBe(0);
    expect(s.collected).toBe(0);
  });
});

describe("clockMinutes()", () => {
  it("parses 24-hour and 12-hour clock strings", () => {
    expect(clockMinutes("18:30")).toBe(18 * 60 + 30);
    expect(clockMinutes("6:30 PM")).toBe(18 * 60 + 30);
    expect(clockMinutes("12:00 AM")).toBe(0);
    expect(clockMinutes("12:00 PM")).toBe(12 * 60);
  });

  it("returns null for empty or unparseable values", () => {
    expect(clockMinutes(null)).toBeNull();
    expect(clockMinutes(undefined)).toBeNull();
    expect(clockMinutes("")).toBeNull();
    expect(clockMinutes("not a time")).toBeNull();
  });
});

describe("turfOccupancy()", () => {
  const matches = () => true;

  it("splits a timed booking's hours and revenue evenly across the hour cells it spans", () => {
    const b = booking({
      booking_date: "2026-09-07", // a Monday
      start_time: "18:00",
      end_time: "20:00",
      total_amount: 1000,
      hours: 2,
    });
    const occ = turfOccupancy([b], matches);
    expect(occ.bookedHours).toBe(2);
    expect(occ.revenue).toBe(1000);
    expect(occ.avgSlotValue).toBe(1000);
    const hour18 = occ.byHour.find((r) => r.label === "18:00")!;
    const hour19 = occ.byHour.find((r) => r.label === "19:00")!;
    expect(hour18.hours).toBe(1);
    expect(hour18.revenue).toBe(500);
    expect(hour19.hours).toBe(1);
    expect(hour19.revenue).toBe(500);
    const mon = occ.byWeekday.find((r) => r.label === "Mon")!;
    expect(mon.hours).toBe(2);
    expect(mon.revenue).toBe(1000);
  });

  it("falls back to the stored hours field when start/end times are missing", () => {
    const b = booking({
      booking_date: "2026-09-07",
      start_time: null,
      end_time: null,
      hours: 3,
    });
    const occ = turfOccupancy([b], matches);
    expect(occ.bookedHours).toBe(3);
    expect(occ.byHour.every((r) => r.hours === 0)).toBe(true);
  });

  it("excludes cancelled, no-show, and merged bookings from the financial figures", () => {
    const occ = turfOccupancy(
      [
        booking({ id: "c1", status: "Cancelled", total_amount: 500 }),
        booking({ id: "c2", merged_into_bill_id: "bill1", total_amount: 500 }),
        booking({ id: "c3", status: "No-show", total_amount: 500 }),
      ],
      matches,
    );
    expect(occ.bookingCount).toBe(0);
    expect(occ.revenue).toBe(0);
  });

  it("counts a cancelled slot's amount separately, and an unpaid slot's balance", () => {
    const occ = turfOccupancy(
      [
        booking({ id: "cancel", status: "Cancelled", total_amount: 400 }),
        booking({ id: "unpaid", total_amount: 1000, advance_paid: 300 }),
      ],
      matches,
    );
    expect(occ.cancelled).toEqual({ count: 1, amount: 400 });
    expect(occ.unpaid).toEqual({ count: 1, amount: 700 });
  });

  it("does not count a no-show slot's unpaid balance as a due", () => {
    const occ = turfOccupancy(
      [booking({ id: "ns", status: "No-show", total_amount: 900 })],
      matches,
    );
    expect(occ.unpaid).toEqual({ count: 0, amount: 0 });
  });

  it("picks the busiest weekday and hour by booked hours", () => {
    const occ = turfOccupancy(
      [
        booking({
          id: "a",
          booking_date: "2026-09-07",
          start_time: "18:00",
          end_time: "19:00",
        }), // Mon
        booking({
          id: "b",
          booking_date: "2026-09-08",
          start_time: "18:00",
          end_time: "21:00",
        }), // Tue, 3hrs
      ],
      matches,
    );
    expect(occ.busiestWeekday?.label).toBe("Tue");
    expect(occ.busiestHour?.label).toBe("18:00");
  });
});

describe("itemPerformance()", () => {
  const matches = () => true;

  it("ranks items by revenue, profit and finds the slowest movers", () => {
    const s1 = sale({
      id: "s1",
      items: [
        {
          item_name: "Chips",
          qty: 10,
          unit_price: 20,
          cost_price: 10,
          amount: 200,
        },
        {
          item_name: "Water",
          qty: 2,
          unit_price: 20,
          cost_price: 18,
          amount: 40,
        },
      ],
    });
    const s2 = sale({
      id: "s2",
      items: [
        {
          item_name: "Chips",
          qty: 5,
          unit_price: 20,
          cost_price: 10,
          amount: 100,
        },
      ],
    });
    const perf = itemPerformance([s1, s2], matches, 5);
    expect(perf.rows.find((r) => r.name === "Chips")?.qty).toBe(15);
    expect(perf.rows.find((r) => r.name === "Chips")?.revenue).toBe(300);
    expect(perf.topByRevenue[0]?.name).toBe("Chips");
    expect(perf.slowMovers[0]?.name).toBe("Water");
    // Chips margin: (300 - 15*10)/300 = 50%; Water margin: (40-2*18)/40 = 10%
    expect(perf.topByProfit[0]?.name).toBe("Chips");
  });

  it("ignores sales outside the period and merged-into-bill sales", () => {
    const inPeriodItems = [
      {
        item_name: "Chips",
        qty: 3,
        unit_price: 20,
        cost_price: 10,
        amount: 60,
      },
    ];
    const inPeriod = sale({
      id: "in",
      sale_date: "2026-09-01",
      items: inPeriodItems,
    });
    const outOfPeriod = sale({
      id: "out",
      sale_date: "2026-08-01",
      items: [
        {
          item_name: "Water",
          qty: 9,
          unit_price: 20,
          cost_price: 18,
          amount: 180,
        },
      ],
    });
    const merged = sale({
      id: "merged",
      merged_into_bill_id: "bill1",
      items: [
        {
          item_name: "Cola",
          qty: 9,
          unit_price: 20,
          cost_price: 18,
          amount: 180,
        },
      ],
    });
    const perf = itemPerformance(
      [inPeriod, outOfPeriod, merged],
      (iso) => iso === "2026-09-01",
    );
    // Only the in-period sale's items should ever be counted.
    const totalQty = perf.rows.reduce((n, r) => n + r.qty, 0);
    expect(totalQty).toBe(inPeriodItems.reduce((n, it) => n + it.qty, 0));
  });
});

describe("customerRanking()", () => {
  const customer = (over: Partial<RankableCustomer>): RankableCustomer => ({
    id: "c1",
    name: "Ravi",
    phone: null,
    bookingsCount: 0,
    totalSpend: 0,
    avgBookingValue: 0,
    outstandingTurfDues: 0,
    ...over,
  });

  it("ranks by spend, by visit frequency, and by amount owed independently", () => {
    const stats = [
      customer({
        id: "a",
        name: "A",
        totalSpend: 5000,
        bookingsCount: 2,
        outstandingTurfDues: 0,
      }),
      customer({
        id: "b",
        name: "B",
        totalSpend: 1000,
        bookingsCount: 10,
        outstandingTurfDues: 300,
      }),
      customer({
        id: "c",
        name: "C",
        totalSpend: 0,
        bookingsCount: 0,
        outstandingTurfDues: 0,
      }),
    ];
    const r = customerRanking(stats, 5);
    expect(r.topSpenders[0]?.id).toBe("a");
    expect(r.mostFrequent[0]?.id).toBe("b");
    expect(r.owing.map((c) => c.id)).toEqual(["b"]);
    // A customer with no spend and no bookings never appears as "active".
    expect(r.topSpenders.some((c) => c.id === "c")).toBe(false);
  });

  it("respects the limit", () => {
    const stats = Array.from({ length: 10 }, (_, i) =>
      customer({ id: `c${i}`, totalSpend: i + 1, bookingsCount: 1 }),
    );
    expect(customerRanking(stats, 3).topSpenders).toHaveLength(3);
  });
});

describe("ageBucket()", () => {
  const now = new Date("2026-09-30T00:00:00Z").getTime();

  it("buckets by whole days elapsed", () => {
    expect(ageBucket("2026-09-30T00:00:00Z", now)).toBe("today");
    expect(ageBucket("2026-09-28T00:00:00Z", now)).toBe("week");
    expect(ageBucket("2026-09-20T00:00:00Z", now)).toBe("month");
    expect(ageBucket("2026-08-01T00:00:00Z", now)).toBe("overdue");
  });
});

describe("duesAgeing()", () => {
  const now = new Date("2026-09-30T00:00:00Z").getTime();

  it("groups outstanding dues by age bucket, oldest first", () => {
    const rows = duesAgeing(
      [
        booking({
          id: "old",
          booking_date: "2026-08-01T00:00:00Z",
          total_amount: 1000,
          advance_paid: 0,
        }),
        booking({
          id: "recent",
          booking_date: "2026-09-30T00:00:00Z",
          total_amount: 500,
          advance_paid: 100,
        }),
      ],
      now,
    );
    expect(rows.map((r) => r.bucket)).toEqual([
      "overdue",
      "month",
      "week",
      "today",
    ]);
    expect(rows.find((r) => r.bucket === "overdue")).toEqual({
      bucket: "overdue",
      label: "30+ days overdue",
      count: 1,
      amount: 1000,
    });
    expect(rows.find((r) => r.bucket === "today")).toEqual({
      bucket: "today",
      label: "Today",
      count: 1,
      amount: 400,
    });
  });

  it("excludes fully-paid bookings, and cancelled/merged bookings entirely", () => {
    const rows = duesAgeing(
      [
        booking({ id: "paid", total_amount: 1000, advance_paid: 1000 }),
        booking({
          id: "cancelled",
          status: "Cancelled",
          total_amount: 1000,
          advance_paid: 0,
        }),
        booking({
          id: "merged",
          merged_into_bill_id: "bill1",
          total_amount: 1000,
          advance_paid: 0,
        }),
      ],
      now,
    );
    expect(rows.every((r) => r.count === 0 && r.amount === 0)).toBe(true);
  });
});

describe("dayKey/monthKey IST bucketing (regression)", () => {
  it("buckets a full UTC timestamp by the IST calendar day, not UTC", () => {
    // 2026-09-06 04:00 IST = 2026-09-05 22:30 UTC: UTC says the 5th, IST says the 6th.
    expect(dayKey("2026-09-05T22:30:00.000Z")).toBe("2026-09-06");
    expect(monthKey("2026-08-31T20:30:00.000Z")).toBe("2026-09");
  });

  it("passes plain YYYY-MM-DD strings through untouched", () => {
    expect(dayKey("2026-09-06")).toBe("2026-09-06");
    expect(monthKey("2026-09-06")).toBe("2026-09");
  });

  it("gives the same answer regardless of the runtime timezone", () => {
    // IST offset is applied explicitly, so these hold on any CI runner/device.
    const instant = new Date("2026-01-01T00:30:00.000Z"); // 06:00 IST, Jan 1
    expect(dayKey(instant)).toBe("2026-01-01");
    expect(monthKey(instant)).toBe("2026-01");
  });
});

describe("no double counting when a balance moves to dues", () => {
  // "Put balance on tab": advance_paid becomes the full ₹1000 while ₹600 is
  // posted as a tab charge. Only ₹400 real cash was taken.
  const movedSources = (paid = 0) =>
    src({
      bookings: [booking({ total_amount: 1000, advance_paid: 1000 })],
      tabEntries: [
        entry({
          kind: "charge",
          amount: 600,
          ref_type: "turf_booking",
          ref_id: "k1",
        }),
        ...(paid
          ? [
              // A Dues-tab collection: a payment row with NO ref_type.
              entry({ kind: "payment", amount: paid, payment_mode: "UPI" }),
            ]
          : []),
      ],
    });

  it("counts collected once while the balance is still on the tab", () => {
    const s = periodStats(movedSources(), matches, settings());
    expect(s.collected).toBe(400);
    expect(s.dues).toBe(0);
  });

  it("counts collected once after the dues are settled", () => {
    const s = periodStats(movedSources(600), matches, settings());
    // ₹400 at the counter + ₹600 collected on the Dues tab = ₹1000, never ₹1600.
    expect(s.collected).toBe(1000);
    expect(s.tabCollected).toBe(600);
    expect(s.dues).toBe(0);
  });

  it("splits by payment mode without inflating the booking's own mode", () => {
    const open = paymentSplit(movedSources(), matches);
    expect(open).toEqual([{ name: "Cash", value: 400 }]);

    const settled = paymentSplit(movedSources(600), matches);
    expect(settled).toEqual([
      { name: "Cash", value: 400 },
      { name: "UPI", value: 600 },
    ]);
    expect(settled.reduce((n, r) => n + r.value, 0)).toBe(1000);
  });

  it("keeps an 'On tab' snack sale out of the split until the tab is paid", () => {
    const onTab = src({
      sales: [sale({ total: 500, payment_mode: TAB_PAYMENT_MODE })],
      tabEntries: [
        entry({
          kind: "charge",
          amount: 500,
          ref_type: "snack_sale",
          ref_id: "s1",
        }),
      ],
    });
    expect(paymentSplit(onTab, matches)).toEqual([]);
    expect(periodStats(onTab, matches, settings()).collected).toBe(0);
  });

  it("counts a 'paid' bill's full gross under its payment mode, even when amount_paid is left stale/zero", () => {
    // A bill marked "paid" has a zero balance by definition — its real
    // collected amount is the gross total, not whatever amount_paid was
    // left at (same convention as periodStats/dues.ts's billCollected()).
    // Reading amount_paid raw would silently drop this bill's money from
    // the chart entirely.
    const b = src({
      bills: [
        bill({
          status: "paid",
          amount_paid: 0,
          total: 1000,
          tax_amount: 180,
          payment_mode: "UPI",
        }),
      ],
    });
    expect(paymentSplit(b, matches)).toEqual([{ name: "UPI", value: 1180 }]);
  });
});
