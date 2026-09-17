import type { BillStatus } from "./biz";

/**
 * Shared payment-state vocabulary for anything with a money balance —
 * bills, turf bookings, and (in future) any other billable record. Keeps
 * the plan's "consistent state badge" language (Paid / Partially paid /
 * Outstanding / Moved to customer tab) in one place instead of each tab
 * inventing its own labels and colors.
 *
 * `BillStatus` ("paid" | "unpaid" | "partial" | "cancelled") is a strict
 * subset of `PaymentState` — a bill's own stored status can be passed
 * straight into `paymentStateLabel`/`paymentStateBadgeClass` with no
 * conversion. "moved" only applies to records whose balance has been
 * relocated onto a customer's running tab (a turf booking or bill that's
 * been merged into a tab entry) — it is never a stored value, only a
 * derived one (see `derivePaymentState`). "cancelled" only ever comes
 * from a bill's own stored status (a voided bill, see `useVoidBill` in
 * data.ts) — nothing derives it.
 */
export type PaymentState = BillStatus | "moved";

export function paymentStateLabel(state: PaymentState): string {
  switch (state) {
    case "paid":
      return "Paid";
    case "partial":
      return "Partially paid";
    case "unpaid":
      return "Outstanding";
    case "moved":
      return "Moved to tab";
    case "cancelled":
      return "Cancelled";
  }
}

/** Same three colors `BillsTab` already used for paid/unpaid/partial —
 * this doesn't change any existing visible color, only centralizes it so
 * a second caller (turf bookings) can match exactly rather than picking
 * its own palette. "moved" reuses the neutral `secondary`-style treatment
 * bills already use for their own "Moved to dues"/"On tab" badge. */
export function paymentStateBadgeClass(state: PaymentState): string {
  switch (state) {
    case "paid":
      return "bg-success text-success-foreground";
    case "partial":
      return "bg-warning text-warning-foreground";
    case "unpaid":
      return "bg-destructive text-destructive-foreground";
    case "moved":
      return "bg-secondary text-secondary-foreground";
    case "cancelled":
      return "bg-muted text-muted-foreground line-through";
  }
}

/**
 * Derives a payment state for a record that doesn't store one directly
 * (a turf booking only stores `advance_paid`, not a paid/unpaid/partial
 * enum the way a bill does). Callers pass in numbers/flags they've
 * already computed via the existing `bookingCashCollected()` /
 * `bookingDue()` / `bookingMovedToDues()` helpers in `dues.ts` — this
 * function does no data lookups of its own, only the same three-way
 * classification `BillsTab` already applies to a bill's stored status.
 */
export function derivePaymentState(args: {
  paid: number;
  due: number;
  moved: boolean;
}): PaymentState {
  if (args.moved) return "moved";
  if (args.due <= 0) return "paid";
  if (args.paid > 0) return "partial";
  return "unpaid";
}
