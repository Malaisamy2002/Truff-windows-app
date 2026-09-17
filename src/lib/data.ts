import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Bill, BillItem, BillStatus, Expense, HistoryEntry } from "./biz";
import { isFinancialBooking } from "./analytics";
import { billDue, bookingDue } from "./dues";
import { tabBalanceOf, tabKey, type TabEntry } from "./tabs";
import { unmergeBill } from "./merge";
import {
  db,
  newId,
  nowIso,
  sortBy,
  type BillRow,
  type ExpenseRow,
} from "./localdb";
import { rowsForYears, useYearWindow, type YearTable } from "./years";

/** Instant-paint cache: reads hydrate from localStorage, then refresh from IndexedDB. */
function cacheKey(name: string) {
  return `ks:cache:${name}`;
}
export function readCache<T>(name: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(cacheKey(name));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
/**
 * Big datasets are not mirrored to localStorage: serialising tens of thousands
 * of rows costs more than the instant-paint it buys (and blows the 5 MB quota).
 * IndexedDB stays the source of truth in that case.
 */
const CACHE_ROW_LIMIT = 1500;

export function writeCache(name: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    if (Array.isArray(value) && value.length > CACHE_ROW_LIMIT) {
      window.localStorage.removeItem(cacheKey(name));
      return;
    }
    window.localStorage.setItem(cacheKey(name), JSON.stringify(value));
  } catch {
    /* quota — ignore */
  }
}

export function useBills() {
  const { years } = useYearWindow();
  return useQuery({
    queryKey: ["bills", years],
    initialData: () => readCache<Bill[]>(`bills:${years.join("-")}`, []),
    queryFn: async () => {
      const raw = await rowsForYears<BillRow>("bills" as YearTable, years);
      const rows = sortBy(raw, "bill_date", "desc");
      const bills = rows.map((b) => ({
        ...b,
        items: (b.items ?? []) as unknown as BillItem[],
        subtotal: Number(b.subtotal),
        discount: Number(b.discount),
        total: Number(b.total),
        amount_paid: Number(b.amount_paid),
        status: b.status as BillStatus,
      })) as Bill[];
      writeCache(`bills:${years.join("-")}`, bills);
      return bills;
    },
  });
}

export function useExpenses() {
  const { years } = useYearWindow();
  return useQuery({
    queryKey: ["expenses", years],
    initialData: () => readCache<Expense[]>(`expenses:${years.join("-")}`, []),
    queryFn: async () => {
      const raw = await rowsForYears<ExpenseRow>(
        "expenses" as YearTable,
        years,
      );
      const rows = sortBy(raw, "spent_at", "desc").map((e) => ({
        ...e,
        amount: Number(e.amount),
      })) as unknown as Expense[];
      writeCache(`expenses:${years.join("-")}`, rows);
      return rows;
    },
  });
}

export function useHistory() {
  return useQuery({
    queryKey: ["history"],
    initialData: () => readCache<HistoryEntry[]>("history", []),
    queryFn: async () => {
      const rows = sortBy(
        await db.history_entries.toArray(),
        "created_at",
        "desc",
      ).map((h) => ({
        ...h,
        rows: (h.rows ?? []) as unknown as BillItem[],
        total: Number(h.total),
      })) as HistoryEntry[];
      writeCache("history", rows);
      return rows;
    },
  });
}

export function useSaveHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      rows: BillItem[];
      total: number;
      note?: string;
    }) => {
      await db.history_entries.add({
        id: newId(),
        rows: payload.rows,
        total: payload.total,
        note: payload.note ?? null,
        created_at: nowIso(),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["history"] }),
  });
}

export function useDeleteHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id?: string) => {
      if (id) await db.history_entries.delete(id);
      else await db.history_entries.clear();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["history"] }),
  });
}

export function useUpdateBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      amount_paid,
      payment_mode,
    }: {
      id: string;
      status: BillStatus;
      amount_paid: number;
      payment_mode?: string | null;
    }) => {
      // A bill moved back to unpaid must lose its old payment mode, otherwise
      // the receipt keeps claiming "Paid by UPI" on a bill with nothing paid —
      // and a bill paid again by a different mode would keep the stale one.
      const modePatch =
        status === "unpaid"
          ? { payment_mode: null }
          : payment_mode === undefined
            ? {}
            : { payment_mode };
      await db.bills.update(id, { status, amount_paid, ...modePatch });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bills"] }),
  });
}

export function useDeleteBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Deleting a merged bill must put every due back exactly where it came
      // from: sources released, the bill's own tab charge reversed, each
      // source's `merge_reverse` row re-charged. unmergeBill() does all of
      // that in one transaction (see lib/merge.ts) — a plain delete used to
      // orphan the sources and make the money vanish from the reports.
      await unmergeBill(id, { deleteBill: true });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bills"] });
      qc.invalidateQueries({ queryKey: ["turf_bookings"] });
      qc.invalidateQueries({ queryKey: ["snack_sales"] });
      qc.invalidateQueries({ queryKey: ["tab_entries"] });
      qc.invalidateQueries({ queryKey: ["customer_tabs"] });
    },
  });
}

/**
 * Voids a bill instead of deleting it: any merged sources get their dues
 * back exactly like an un-merge, and the bill itself flips to
 * `status: "cancelled"` — a historical record with no live due and no
 * revenue (see billDue/billCollected in dues.ts), distinct from
 * `useDeleteBill`, which removes the row entirely.
 */
export function useVoidBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await unmergeBill(id, { cancel: true });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bills"] });
      qc.invalidateQueries({ queryKey: ["turf_bookings"] });
      qc.invalidateQueries({ queryKey: ["snack_sales"] });
      qc.invalidateQueries({ queryKey: ["tab_entries"] });
      qc.invalidateQueries({ queryKey: ["customer_tabs"] });
    },
  });
}

/** Un-merges a bill but keeps it (its dues go back to the source records). */
export function useUnmergeBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await unmergeBill(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bills"] });
      qc.invalidateQueries({ queryKey: ["turf_bookings"] });
      qc.invalidateQueries({ queryKey: ["snack_sales"] });
      qc.invalidateQueries({ queryKey: ["tab_entries"] });
      qc.invalidateQueries({ queryKey: ["customer_tabs"] });
    },
  });
}

export function useAddExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      category: string;
      note: string;
      amount: number;
    }) => {
      const now = nowIso();
      await db.expenses.add({
        id: newId(),
        expense_no: null,
        business: "Shared",
        category: payload.category,
        description: null,
        note: payload.note || null,
        amount: payload.amount,
        spent_at: now,
        receipt_path: null,
        created_at: now,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["expenses_v2"] });
    },
  });
}

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await db.expenses.delete(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["expenses_v2"] });
    },
  });
}

export type CustomerRec = { id: string; name: string; phone: string | null };

const normName = (v: string | null | undefined) =>
  (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const normPhone = (v: string | null | undefined) =>
  (v ?? "").replace(/\D/g, "").slice(-10);

/** Identity key: phone wins when present, otherwise the normalised name. */
function customerKey(c: { name: string; phone: string | null }) {
  const p = normPhone(c.phone);
  return p ? `p:${p}` : `n:${normName(c.name)}`;
}

// Exported so other modules matching a bill/booking/sale back to a customer
// (e.g. the dashboard export's lifetime-spend rollup) use the exact same
// identity rules as the merge/dedupe logic above, instead of a second,
// possibly-drifting copy of "what counts as the same customer".
export { normName, normPhone, customerKey };

export type CustomerLifetime = {
  id: string;
  name: string;
  phone: string | null;
  bookingsCount: number;
  totalSpend: number;
  /** Revenue from standalone Bills matched to this customer. */
  billsSpend: number;
  /** Revenue from this customer's still-standalone turf bookings — i.e.
   *  isFinancialBooking() ones only. A booking merged into a bill has its
   *  value counted in billsSpend instead (excluded here to avoid
   *  double-counting); a Cancelled booking was never real revenue. */
  turfSpend: number;
  /** Revenue from snack sales matched to this customer. */
  snacksSpend: number;
  /** Average value per turf booking (all bookings, merged or not — this is
   *  a per-booking stat, not a cash total, so merge status doesn't matter). */
  avgBookingValue: number;
  /** Sum of bookingDue() (dues.ts) across this customer's unmerged turf
   *  bookings — tax-inclusive, tab-aware, the same figure the Turf tab, Dues
   *  tab and Dashboard show for the same booking. A booking merged into a
   *  bill is settled through that bill instead, matching the app-wide
   *  "Outstanding turf dues" convention. */
  outstandingTurfDues: number;
  /** Sum of billDue() across this customer's bills (tax-inclusive, tab-aware). */
  outstandingBillDues: number;
  /** This customer's running-tab balance (charges minus payments, never negative). */
  outstandingTab: number;
  /** Everything still owed: turf dues + bill dues + running tab — the same
   *  total customerOutstanding() (dues.ts) shows in the customer dialog. */
  outstandingTotal: number;
  /** ISO date of the earliest bill/booking/sale matched to this customer. */
  firstActivity: string | null;
  /** ISO date of the most recent bill/booking/sale matched to this customer. */
  lastActivity: string | null;
};

/**
 * Phone-first identity: when BOTH the saved customer and the record carry a
 * phone number, only the numbers are compared — two different people who
 * happen to share a name must never collapse into one row. Name matching is
 * the fallback only when at least one side has no phone at all.
 */
export function matchesCustomer(
  c: { name: string; phone: string | null },
  name: string | null | undefined,
  phone?: string | null,
) {
  const cPhone = normPhone(c.phone);
  const rPhone = normPhone(phone);
  if (cPhone && rPhone) return cPhone === rPhone;
  return normName(name) === normName(c.name);
}

/**
 * Looks up a phone number for a record type that doesn't store its own
 * (e.g. `SnackSale`, which only has `customer_name`) by exact saved-name
 * match — deliberately conservative: only returns something when exactly
 * one saved customer's name matches (their phone, which may itself be
 * null if they have none on file). Zero matches, more than one match, or
 * a matched customer with no saved phone, all return `null` rather than
 * guessing — `whatsappUrl()` already degrades gracefully for a
 * missing/invalid phone by opening WhatsApp's own contact picker instead
 * of silently messaging the wrong person, so `null` here is a safe,
 * ordinary outcome, not an error case to handle specially.
 */
export function customerPhoneForName(
  customers: CustomerRec[],
  name: string | null | undefined,
): string | null {
  const target = normName(name);
  if (!target) return null;
  const matches = customers.filter((c) => normName(c.name) === target);
  return matches.length === 1 ? matches[0]!.phone : null;
}

/**
 * Rolls up lifetime turf-booking count, total spend (bills + unmerged
 * bookings + snack sales) and everything still owed (turf dues + bill dues
 * + running tab) per saved customer, matched by the phone-first /
 * name-fallback identity rule in `matchesCustomer` — the same rule
 * `useMergeCustomers` uses when re-tagging records — kept as one function
 * so every screen agrees on "same customer or not".
 */
export function customerLifetimeStats(
  customers: CustomerRec[],
  data: {
    bills: (Pick<
      Bill,
      "customer_name" | "customer_phone" | "total" | "bill_date"
    > &
      Partial<
        Pick<
          Bill,
          | "id"
          | "status"
          | "amount_paid"
          | "payment_mode"
          | "tax_amount"
          | "tax_lines"
        >
      >)[];
    bookings: {
      id: string;
      customer_name: string;
      phone: string | null;
      total_amount: number;
      advance_paid: number;
      booking_date: string;
      status: string;
      merged_into_bill_id?: string | null;
      // Needed to route outstandingTurfDues through the same tax-inclusive
      // bookingDue() the Turf/Dues tabs and Dashboard use (dues.ts) instead
      // of re-deriving total_amount - advance_paid by hand, which silently
      // ignores tax on a taxed booking.
      turf_amount: number;
      hours: number;
      rate_per_hour: number;
      courts: number;
      snacks_total?: number;
      discount?: number;
      tax_amount?: number;
      tax_lines?: { label: string; value: number }[];
    }[];
    sales: {
      customer_name: string | null;
      phone?: string | null;
      total: number;
      sale_date: string;
    }[];
    /** The tab ledger — without it a balance moved to the tab is invisible here. */
    tabEntries?: TabEntry[];
  },
): CustomerLifetime[] {
  const entries = data.tabEntries ?? [];
  return customers.map((c) => {
    const matches = (name: string | null | undefined, phone?: string | null) =>
      matchesCustomer(c, name, phone);
    const myEntries = entries.filter(
      (e) => e.customer_key === tabKey(c.name, c.phone),
    );

    let bookingsCount = 0;
    let billsSpend = 0;
    let turfSpend = 0;
    let snacksSpend = 0;
    let turfGrossForAvg = 0;
    let outstandingTurfDues = 0;
    let outstandingBillDues = 0;
    let firstActivity: string | null = null;
    let lastActivity: string | null = null;
    const bump = (iso: string) => {
      if (!firstActivity || iso < firstActivity) firstActivity = iso;
      if (!lastActivity || iso > lastActivity) lastActivity = iso;
    };

    for (const b of data.bills) {
      if (matches(b.customer_name, b.customer_phone)) {
        billsSpend += Number(b.total) || 0;
        // Callers that pass full bills get the canonical tax-inclusive,
        // tab-aware billDue(); a projected row without status owes nothing.
        if (b.id && b.status)
          outstandingBillDues += billDue(b as Bill, myEntries);
        bump(b.bill_date);
      }
    }
    // A booking merged into a bill has its own revenue already counted via
    // that bill above — same double-counting hazard as the raw Turf
    // bookings export sheet, so it's excluded from turfSpend too (the
    // booking still counts toward bookingsCount and avgBookingValue).
    for (const b of data.bookings) {
      if (matches(b.customer_name, b.phone)) {
        bookingsCount += 1;
        turfGrossForAvg += Number(b.total_amount) || 0;
        // Money fields (turfSpend, outstandingTurfDues) route through the
        // same isFinancialBooking() predicate every other revenue/dues
        // calculation in the app uses — see docs/calculation-rules.md §2.
        // bookingsCount/turfGrossForAvg deliberately do NOT filter through
        // it: they're per-visit stats, not cash, so a merged (or even
        // cancelled) booking still counts as a real visit that happened.
        if (isFinancialBooking(b)) {
          turfSpend += Number(b.total_amount) || 0;
          // Tax-inclusive and tab-aware, via the same bookingDue() the Turf
          // tab, Dues tab and Dashboard use.
          outstandingTurfDues += bookingDue(b, myEntries);
        }
        bump(b.booking_date);
      }
    }
    for (const s of data.sales) {
      if (matches(s.customer_name, s.phone)) {
        snacksSpend += Number(s.total) || 0;
        bump(s.sale_date);
      }
    }

    const outstandingTab = Math.max(0, tabBalanceOf(myEntries));
    const totalSpend = billsSpend + turfSpend + snacksSpend;
    const avgBookingValue =
      bookingsCount > 0 ? turfGrossForAvg / bookingsCount : 0;

    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      bookingsCount,
      totalSpend,
      billsSpend,
      turfSpend,
      snacksSpend,
      avgBookingValue,
      outstandingTurfDues,
      outstandingBillDues,
      outstandingTab,
      outstandingTotal:
        outstandingTurfDues + outstandingBillDues + outstandingTab,
      firstActivity,
      lastActivity,
    };
  });
}

/** Collapse duplicate rows, keeping the richest record (one with a phone) per identity. */
function dedupeCustomers(rows: CustomerRec[]) {
  const byKey = new Map<string, CustomerRec>();
  const dupIds: string[] = [];
  for (const c of rows) {
    const key = customerKey(c);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, c);
      continue;
    }
    // keep whichever has a phone number; drop the other
    if (!normPhone(existing.phone) && normPhone(c.phone)) {
      dupIds.push(existing.id);
      byKey.set(key, c);
    } else {
      dupIds.push(c.id);
    }
  }
  return { unique: [...byKey.values()], dupIds };
}

async function loadCustomers(): Promise<CustomerRec[]> {
  const rows = sortBy(await db.customers.toArray(), "created_at", "desc");
  return rows.map((c) => ({ id: c.id, name: c.name, phone: c.phone }));
}

/** Directory of saved customers — powers two-way name/phone autofill. */
export function useCustomers() {
  return useQuery({
    queryKey: ["customers"],
    initialData: () => readCache<CustomerRec[]>("customers", []),
    queryFn: async () => {
      const { unique } = dedupeCustomers(await loadCustomers());
      writeCache("customers", unique);
      return unique;
    },
  });
}

export type SaveCustomerResult = "created" | "duplicate" | "updated";

export function useSaveCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      name: string;
      phone?: string | null;
    }): Promise<SaveCustomerResult> => {
      const name = payload.name.trim();
      const phone = (payload.phone ?? "").replace(/\D/g, "") || null;
      if (!name) throw new Error("Customer needs a name");

      const rows = await loadCustomers();
      const match =
        (phone
          ? rows.find((c) => normPhone(c.phone) === normPhone(phone))
          : undefined) ??
        (phone
          ? rows.find(
              (c) => normName(c.name) === normName(name) && !normPhone(c.phone),
            )
          : rows.find((c) => normName(c.name) === normName(name)));

      if (match) {
        const needsPhone = phone && !normPhone(match.phone);
        const needsName = name && normName(match.name) !== normName(name);
        if (!needsPhone && !needsName) return "duplicate";
        await db.customers.update(match.id, {
          name: needsName ? name : match.name,
          phone: needsPhone ? phone : match.phone,
        });
        return "updated";
      }

      await db.customers.add({
        id: newId(),
        name,
        phone,
        created_at: nowIso(),
      });
      return "created";
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}

/**
 * Direct, id-based edit — for the Customers tab's explicit "Edit" action.
 * Deliberately separate from `useSaveCustomer` above: that hook's job is
 * name/phone-based upsert (autofill from Turf/Snacks/Bills, where there's no
 * customer id yet to key off of), so passing it an edited name *and* phone
 * for an existing row risks its match logic finding a different row (or
 * none) instead of updating this one in place. This hook always updates the
 * exact row `id` points at, and only refuses if the new phone collides with
 * a *different* saved customer.
 */
export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      id: string;
      name: string;
      phone?: string | null;
    }) => {
      const name = payload.name.trim();
      if (!name) throw new Error("Customer needs a name");
      const phone = (payload.phone ?? "").replace(/\D/g, "") || null;

      if (phone) {
        const rows = await loadCustomers();
        const clash = rows.find(
          (c) => c.id !== payload.id && normPhone(c.phone) === normPhone(phone),
        );
        if (clash) throw new Error(`Phone already saved for "${clash.name}"`);
      }

      await db.customers.update(payload.id, { name, phone });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}

/** One-tap cleanup: permanently delete duplicate customer rows already stored. */
export function useCleanupDuplicateCustomers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<number> => {
      const { dupIds } = dedupeCustomers(await loadCustomers());
      if (!dupIds.length) return 0;
      await db.customers.bulkDelete(dupIds);
      return dupIds.length;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await db.customers.delete(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}

/**
 * Manual merge: pick a "keep" customer and one or more "absorb" customers.
 * Every bill / turf booking / snack sale recorded under an absorbed customer's
 * old name+phone is re-pointed to the kept identity, then the absorbed
 * customer rows are deleted.
 */
export function useMergeCustomers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      keep: CustomerRec;
      absorb: CustomerRec[];
      finalName: string;
      finalPhone: string | null;
    }) => {
      const finalName = payload.finalName.trim();
      const finalPhone = payload.finalPhone
        ? payload.finalPhone.replace(/\D/g, "")
        : null;
      if (!finalName) throw new Error("Merged customer needs a name");

      for (const c of payload.absorb) {
        const nameMatch = normName(c.name);

        const bills = await db.bills.toArray();
        for (const b of bills) {
          if (matchesCustomer(c, b.customer_name, b.customer_phone))
            await db.bills.update(b.id, {
              customer_name: finalName,
              customer_phone: finalPhone,
            });
        }

        const bookings = await db.turf_bookings.toArray();
        for (const b of bookings) {
          if (matchesCustomer(c, b.customer_name as string, b.phone as string))
            await db.turf_bookings.update(b.id, {
              customer_name: finalName,
              phone: finalPhone,
            });
        }

        // Snack sales have no phone field, so name-only matching is correct here.
        const sales = await db.snack_sales.toArray();
        for (const s of sales) {
          if (normName(s.customer_name as string) === nameMatch)
            await db.snack_sales.update(s.id, { customer_name: finalName });
        }
      }

      await db.customers.update(payload.keep.id, {
        name: finalName,
        phone: finalPhone,
      });

      const absorbIds = payload.absorb.map((c) => c.id);
      if (absorbIds.length) await db.customers.bulkDelete(absorbIds);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["bills"] });
      qc.invalidateQueries({ queryKey: ["turf_bookings"] });
      qc.invalidateQueries({ queryKey: ["snack_sales"] });
    },
  });
}
