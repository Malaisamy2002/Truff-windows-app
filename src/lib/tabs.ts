import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  db,
  newId,
  nowIso,
  sortBy,
  type CustomerTabRow,
  type TabEntryRow,
} from "./localdb";
import { rupees } from "./money";
import { localDateStr } from "./utils";

/**
 * Running customer tabs ("khata"): a per-customer ledger of dues added and
 * payments collected, tagged Turf or Snacks.
 *
 * Design rules (kept deliberately simple so the money can't be double counted):
 * - The tab balance is ALWAYS derived from tab_entries — never stored.
 * - Turf bookings / bills keep their own advance-vs-total dues exactly as
 *   before. A tab charge is only created when the operator explicitly puts an
 *   amount on the tab (snack bill paid "on tab", or a manual due), so the same
 *   rupee is never owed twice.
 * - Closing a tab requires a zero balance (or an explicit write-off note).
 */

export type CustomerTab = CustomerTabRow;
export type TabEntry = TabEntryRow;

export const TAB_BUSINESSES = ["Turf", "Snacks"] as const;
export type TabBusiness = (typeof TAB_BUSINESSES)[number];

/**
 * Typed `ref_type` values. Every ledger row that came from a record in the app
 * carries one of these, so `netTabAmountFor()` (see lib/dues.ts) can net a
 * source's charges and payments exactly instead of guessing from notes.
 */
export const TAB_REF_TURF_BOOKING = "turf_booking";
export const TAB_REF_SNACK_SALE = "snack_sale";
export const TAB_REF_BILL = "bill";
/** A source charge taken off the tab because a merged bill now owns it. */
export const TAB_REF_MERGE_REVERSE = "merge_reverse";
export type TabRefType =
  | typeof TAB_REF_TURF_BOOKING
  | typeof TAB_REF_SNACK_SALE
  | typeof TAB_REF_BILL
  | typeof TAB_REF_MERGE_REVERSE;

/**
 * Identity key for a tab. Phone (digits only) wins when present so a name typo
 * still lands on the same tab; otherwise the lowercased name is used.
 */
export function tabKey(
  name: string | null | undefined,
  phone: string | null | undefined,
) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length >= 10) return `p:${digits.slice(-10)}`;
  return `n:${String(name ?? "")
    .trim()
    .toLowerCase()}`;
}

export const tabBalanceOf = (entries: TabEntry[]) =>
  rupees(
    entries.reduce(
      (s, e) =>
        s + (e.kind === "charge" ? rupees(e.amount) : -rupees(e.amount)),
      0,
    ),
  );

/** All tabs, newest activity first. */
export function useCustomerTabs() {
  return useQuery({
    queryKey: ["customer_tabs"],
    queryFn: async () =>
      sortBy(await db.customer_tabs.toArray(), "opened_at", "desc"),
    initialData: [] as CustomerTab[],
  });
}

/** Every tab entry (the ledger is small — one row per due/payment). */
export function useTabEntries() {
  return useQuery({
    queryKey: ["tab_entries"],
    queryFn: async () =>
      sortBy(await db.tab_entries.toArray(), "created_at", "desc"),
    initialData: [] as TabEntry[],
  });
}

export type TabSummary = {
  tab: CustomerTab | null;
  entries: TabEntry[];
  balance: number;
  charged: number;
  paid: number;
};

/** Balance + entries per customer_key, ready for search results and dialogs. */
export function useTabSummaries() {
  const { data: tabs = [] } = useCustomerTabs();
  const { data: entries = [] } = useTabEntries();

  // Memoized: this used to rebuild the whole Map on every render of every
  // caller, which invalidated every downstream useMemo that lists it as a
  // dependency (e.g. the per-customer dues in the Customers directory, which
  // re-ran on every keystroke in the search box). Treat the result as
  // read-only — it is shared between callers.
  return useMemo(() => {
    const map = new Map<string, TabSummary>();
    for (const tab of tabs) {
      map.set(tab.customer_key, {
        tab,
        entries: [],
        balance: 0,
        charged: 0,
        paid: 0,
      });
    }
    for (const e of entries) {
      let s = map.get(e.customer_key);
      if (!s) {
        s = { tab: null, entries: [], balance: 0, charged: 0, paid: 0 };
        map.set(e.customer_key, s);
      }
      s.entries.push(e);
      if (e.kind === "charge") s.charged += rupees(e.amount);
      else s.paid += rupees(e.amount);
    }
    for (const s of map.values()) s.balance = rupees(s.charged - s.paid);
    return map;
  }, [tabs, entries]);
}

/** Finds an open tab or opens a new one, returning its id. */
export async function ensureTab(name: string, phone: string | null) {
  const key = tabKey(name, phone);
  const existing = await db.customer_tabs
    .where("customer_key")
    .equals(key)
    .toArray();
  const open = existing.find((t) => t.status === "open");
  if (open) {
    // Keep the display name/phone fresh without touching the ledger.
    if (open.customer_name !== name || (phone && open.phone !== phone)) {
      await db.customer_tabs.update(open.id, {
        customer_name: name || open.customer_name,
        phone: phone ?? open.phone,
      });
    }
    return open.id;
  }
  const id = newId();
  const now = nowIso();
  await db.customer_tabs.add({
    id,
    customer_key: key,
    customer_name: name,
    phone: phone ?? null,
    status: "open",
    opened_at: now,
    closed_at: null,
    created_at: now,
  });
  return id;
}

export type AddTabEntryInput = {
  name: string;
  phone?: string | null;
  kind: "charge" | "payment";
  business?: string;
  amount: number;
  note?: string | null;
  ref_type?: string | null;
  ref_id?: string | null;
  source_ref_type?: string | null;
  source_ref_id?: string | null;
  payment_mode?: string | null;
  entry_date?: string;
};

/**
 * Builds one ledger row. Callers inside a Dexie transaction use this (via
 * `writeTabEntries`) so a multi-entry write — e.g. a merge that reverses three
 * source charges and adds one bill charge — either lands whole or not at all.
 */
export async function buildTabEntry(
  input: AddTabEntryInput,
): Promise<TabEntry> {
  const name = input.name.trim();
  if (!name) throw new Error("Customer name is required for a tab");
  const amount = rupees(input.amount);
  if (amount <= 0) throw new Error("Amount must be more than 0");
  const phone = input.phone?.trim() || null;
  const tabId = await ensureTab(name, phone);
  return {
    id: newId(),
    tab_id: tabId,
    customer_key: tabKey(name, phone),
    kind: input.kind,
    business: input.business || "Turf",
    amount,
    note: input.note?.trim() || null,
    ref_type: input.ref_type ?? null,
    ref_id: input.ref_id ?? null,
    source_ref_type: input.source_ref_type ?? null,
    source_ref_id: input.source_ref_id ?? null,
    payment_mode: input.payment_mode ?? null,
    // Local calendar day, NOT the UTC date: nowIso() is a UTC timestamp, so
    // slicing it filed anything recorded between midnight and 5:30 am IST
    // under the previous day.
    entry_date: input.entry_date || localDateStr(),
    created_at: nowIso(),
  };
}

/**
 * Writes several ledger rows as one unit. MUST be called from inside a
 * `db.transaction("rw", db.customer_tabs, db.tab_entries, …)` block (merges do
 * exactly that) so a failure can never leave a half-reversed tab.
 */
export async function writeTabEntries(inputs: AddTabEntryInput[]) {
  const entries: TabEntry[] = [];
  for (const input of inputs) entries.push(await buildTabEntry(input));
  if (entries.length) await db.tab_entries.bulkAdd(entries);
  return entries;
}

/** Adds a due (charge) or a collection (payment) to the customer's tab. */
export function useAddTabEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddTabEntryInput) => {
      const entry = await buildTabEntry(input);
      await db.tab_entries.add(entry);
      return entry;
    },

    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tab_entries"] });
      qc.invalidateQueries({ queryKey: ["customer_tabs"] });
    },
  });
}

/** Removes a single ledger row (mis-typed due or payment). */
export function useDeleteTabEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await db.tab_entries.delete(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tab_entries"] });
      qc.invalidateQueries({ queryKey: ["customer_tabs"] });
    },
  });
}

/**
 * Settles the whole balance in one tap: records a payment for the remaining
 * amount, then closes the tab.
 */
export function useSettleAndCloseTab() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      tabId: string;
      note?: string | null;
      payment_mode?: string | null;
    }) => {
      await db.transaction("rw", db.customer_tabs, db.tab_entries, async () => {
        const tab = await db.customer_tabs.get(input.tabId);
        if (!tab) throw new Error("Tab not found");
        const entries = await db.tab_entries
          .where("tab_id")
          .equals(tab.id)
          .toArray();
        const balance = tabBalanceOf(entries);
        if (balance > 0) {
          await db.tab_entries.add({
            id: newId(),
            tab_id: tab.id,
            customer_key: tab.customer_key,
            kind: "payment",
            business: "Shared",
            amount: balance,
            note: input.note?.trim() || "Final settlement",
            ref_type: null,
            ref_id: null,
            payment_mode: input.payment_mode ?? null,
            entry_date: localDateStr(),
            created_at: nowIso(),
          });
        }
        await db.customer_tabs.update(tab.id, {
          status: "closed",
          closed_at: nowIso(),
        });
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tab_entries"] });
      qc.invalidateQueries({ queryKey: ["customer_tabs"] });
    },
  });
}

/** Closes a tab that is already fully paid; refuses while money is owed. */
export function useCloseTab() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tabId: string) => {
      const tab = await db.customer_tabs.get(tabId);
      if (!tab) throw new Error("Tab not found");
      const entries = await db.tab_entries
        .where("tab_id")
        .equals(tabId)
        .toArray();
      if (tabBalanceOf(entries) > 0)
        throw new Error("Tab still has a balance — collect or settle it first");
      await db.customer_tabs.update(tabId, {
        status: "closed",
        closed_at: nowIso(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer_tabs"] });
    },
  });
}

/** Re-opens a closed tab (customer starts a fresh running balance). */
export function useReopenTab() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tabId: string) => {
      await db.customer_tabs.update(tabId, { status: "open", closed_at: null });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customer_tabs"] }),
  });
}
