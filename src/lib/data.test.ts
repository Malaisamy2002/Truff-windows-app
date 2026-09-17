import { describe, expect, it } from "vitest";

import { customerLifetimeStats, type CustomerRec } from "./data";
import { bookingDue } from "./dues";

// Minimal booking shape customerLifetimeStats accepts — see the widened
// inline type on its `data.bookings` param in data.ts.
const taxedBooking = (over: Record<string, unknown> = {}) => ({
  id: "k1",
  customer_name: "Ravi",
  phone: "9876543210",
  booking_date: "2026-09-01",
  total_amount: 1000,
  advance_paid: 0,
  status: "Booked",
  merged_into_bill_id: null,
  turf_amount: 1000,
  hours: 1,
  rate_per_hour: 1000,
  courts: 1,
  tax_amount: 180, // frozen 18% GST, exactly as ops.ts freezes it at creation
  ...over,
});

const customer: CustomerRec = {
  id: "c1",
  name: "Ravi",
  phone: "9876543210",
} as CustomerRec;

describe("customerLifetimeStats() outstandingTurfDues", () => {
  it("is tax-inclusive and matches dues.ts's bookingDue() for the same booking", () => {
    const booking = taxedBooking();
    const [row] = customerLifetimeStats([customer], {
      bills: [],
      bookings: [booking as never],
      sales: [],
    });
    if (!row) throw new Error("expected a customerLifetimeStats row");

    // Before the fix this summed (total_amount - advance_paid) = 1000, silently
    // dropping the ₹180 GST the booking's own receipt actually charged and
    // that dues.ts's bookingDue() already accounts for.
    expect(row.outstandingTurfDues).toBe(bookingDue(booking as never));
    expect(row.outstandingTurfDues).toBe(1180);
  });

  it("still excludes a booking merged into a bill, same as isFinancialBooking elsewhere", () => {
    const booking = taxedBooking({ merged_into_bill_id: "bill-1" });
    const [row] = customerLifetimeStats([customer], {
      bills: [],
      bookings: [booking as never],
      sales: [],
    });
    if (!row) throw new Error("expected a customerLifetimeStats row");

    expect(row.outstandingTurfDues).toBe(0);
    // But it's still a real visit, so turfSpend excludes it while bookingsCount doesn't.
    expect(row.bookingsCount).toBe(1);
    expect(row.turfSpend).toBe(0);
  });
});
