import { toast } from "sonner";
import { billGrossTotal, bookingGrossTotal, type Bill } from "./biz";
import { useUpdateBill } from "./data";
import { useUpdateTurfBooking, type TurfBooking } from "./ops";
import { billDue, bookingDue } from "./dues";
import { INVOICE_SECTIONS } from "./desktop";
import { paymentReceipt, printReceipt } from "./receipt";
import {
  tabKey,
  useSettleAndCloseTab,
  useTabSummaries,
  type TabEntry,
} from "./tabs";

/**
 * Settle-all for one customer — the exact mutation sequence
 * `CustomerDetailContent`'s "Settle all" button already used (marks every
 * open booking Completed at full advance, every open bill paid at full
 * gross, then closes the running tab), pulled out here so a second caller
 * (`OutstandingTab`'s row-level context menu) can trigger the same action
 * without re-deriving or duplicating the math. `CustomerDetailContent`
 * itself was updated to call this too, so there is exactly one place this
 * logic lives.
 *
 * Callers must pass bookings/bills already filtered to this one customer
 * (e.g. via `matchesCustomer`) — this hook does no identity matching of
 * its own, same division of responsibility `collectLine` already had.
 */
export function useSettleCustomer() {
  const updateBooking = useUpdateTurfBooking();
  const updateBill = useUpdateBill();
  const settleTab = useSettleAndCloseTab();
  const tabSummaries = useTabSummaries();

  const settleAll = (params: {
    name: string;
    phone: string | null;
    myBookings: TurfBooking[];
    myBills: Bill[];
    myEntries: TabEntry[];
    tabBalance: number;
  }) => {
    const { name, phone, myBookings, myBills, myEntries, tabBalance } = params;

    // Computed up front, before the mutations below fire, purely for the
    // "Print receipt" toast action — every branch that contributes to this
    // customer's balance settles to Cash here (the tab-close call a few
    // lines down already hardcodes "Cash"; the booking/bill branches carry
    // no mode field of their own to settle with any other value), so the
    // slip's mode always matches what was actually recorded.
    const total =
      myBookings.reduce(
        (s, b) => s + Math.max(0, bookingDue(b, myEntries)),
        0,
      ) +
      myBills.reduce((s, b) => s + Math.max(0, billDue(b, myEntries)), 0) +
      Math.max(0, tabBalance);

    for (const b of myBookings) {
      const due = bookingDue(b, myEntries);
      if (due <= 0) continue;
      updateBooking.mutate(
        {
          id: b.id,
          advance_paid: bookingGrossTotal(b),
          status: "Completed" as const,
        },
        {
          onSuccess: () => toast.success("Booking marked paid"),
          onError: (e) => toast.error(e.message),
        },
      );
    }

    for (const bill of myBills) {
      const due = billDue(bill, myEntries);
      if (due <= 0) continue;
      updateBill.mutate(
        {
          id: bill.id,
          status: "paid" as const,
          amount_paid: billGrossTotal(bill),
        },
        {
          onSuccess: () => toast.success("Bill marked paid"),
          onError: (e) => toast.error(e.message),
        },
      );
    }

    const tab = tabSummaries.get(tabKey(name, phone))?.tab;
    if (tab && tabBalance > 0) {
      settleTab.mutate(
        { tabId: tab.id, payment_mode: "Cash" },
        { onError: (e) => toast.error(e.message) },
      );
    }

    toast.success("Settling full balance…", {
      action:
        total > 0
          ? {
              label: "Print receipt",
              onClick: () =>
                printReceipt(
                  paymentReceipt({
                    customer: name,
                    phone,
                    against: "Full balance",
                    amount: total,
                    mode: "Cash",
                    balanceAfter: 0,
                  }),
                  undefined,
                  INVOICE_SECTIONS.dues,
                ),
            }
          : undefined,
    });
  };

  return {
    settleAll,
    isPending:
      updateBooking.isPending || updateBill.isPending || settleTab.isPending,
  };
}
