import Dexie, { type Table } from "dexie";

/**
 * Local-first database. Everything the app stores lives here in IndexedDB —
 * no network call is needed for any read or write. Telegram backup/restore is
 * the only feature that touches the internet, and it is entirely optional.
 */

export type Row = Record<string, unknown>;

export type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  created_at: string;
};

export type BillRow = {
  id: string;
  invoice_no: string;
  customer_name: string;
  customer_phone: string | null;
  items: unknown[];
  subtotal: number;
  discount: number;
  total: number;
  /**
   * Tax frozen at bill creation (lib/biz.ts billGrossTotal). Rows created
   * before this field existed leave it undefined; those legacy bills fall
   * back to today's live tax settings (a documented limitation of pre-fix
   * data), while every new bill reprints exactly as first issued even after
   * the GST rate or toggle changes.
   */
  tax_amount?: number;
  tax_lines?: { label: string; value: number }[];
  amount_paid: number;
  status: string;
  payment_mode?: string | null;
  bill_date: string;
  created_at: string;
};

export type ExpenseRow = {
  id: string;
  expense_no: string | null;
  business: string;
  category: string;
  description: string | null;
  note: string | null;
  amount: number;
  spent_at: string;
  receipt_path: string | null;
  created_at: string;
};

export type HistoryRow = {
  id: string;
  rows: unknown[];
  total: number;
  note: string | null;
  created_at: string;
};

export type TurfRateRow = {
  id: string;
  slot_name: string;
  rate_per_hour: number;
  rate_15: number | null;
  rate_30: number | null;
  rate_45: number | null;
  rate_60: number | null;
  allow_15?: boolean;
  allow_30?: boolean;
  allow_45?: boolean;
  allow_60?: boolean;
  is_active: boolean;
  created_at: string;
};

export type SnackItemRow = {
  id: string;
  item_name: string;
  category: string;
  unit_price: number;
  cost_price: number;
  is_active: boolean;
  stock_quantity: number;
  low_stock_threshold: number;
  created_at: string;
  /** Last time stock_quantity changed (not other fields), for the stock card. */
  stock_updated_at?: string;
};

/** Why a stock quantity changed. "sale"/"sale_reversal" are applied
 * automatically by checkout and bill deletion; the rest are chosen by
 * whoever is recording the change. Optional so pre-existing history rows
 * (recorded before this field existed) remain valid — an absent reason is
 * shown as "Adjustment" rather than treated as an error. */
export type SnackStockReason =
  | "sale"
  | "sale_reversal"
  | "purchase"
  | "damage"
  | "expired"
  | "manual_correction"
  | "opening_stock"
  | "stock_take";

/** One row per stock change: +/- taps, "Add" entries, reasoned adjustments,
 * and stock-take corrections. */
export type SnackStockHistoryRow = {
  id: string;
  item_id: string;
  item_name: string;
  delta: number;
  previous_quantity: number;
  new_quantity: number;
  created_at: string;
  reason?: SnackStockReason | null;
  /** Groups every row saved together by one stock-take session, so the
   * history popover can show "part of a N-item stock take" instead of N
   * unrelated-looking entries with the same timestamp. Unset for every
   * other kind of change. */
  batch_id?: string | null;
};

export type TurfBookingRow = {
  id: string;
  booking_no: string;
  booking_date: string;
  customer_name: string;
  phone: string | null;
  slot_name: string;
  hours: number;
  rate_per_hour: number;
  total_amount: number;
  /** Tax frozen when the booking was saved (see lib/biz.ts TaxSnapshot). */
  tax_amount?: number;
  tax_lines?: { label: string; value: number }[];
  advance_paid: number;
  payment_mode: string;
  status: string;
  discount: number;
  notes: string | null;
  start_time: string | null;
  end_time: string | null;
  courts: number;
  snacks: unknown[];
  snacks_total: number;
  turf_amount: number;
  created_at: string;
  /** Set when this booking's revenue has been rolled into a bill via "Merge
   * turf + snacks bill" — excluded from revenue/dues totals from then on so
   * the same sale isn't counted both here and on the bill. The booking row
   * itself is kept (not deleted) so the court/time-slot stays occupied for
   * double-booking checks and the booking still shows in history. */
  merged_into_bill_id?: string | null;
};

export type SnackSaleRow = {
  id: string;
  bill_no: string;
  sale_date: string;
  customer_name: string | null;
  items: unknown[];
  total: number;
  /** Tax frozen when the sale was saved (see lib/biz.ts TaxSnapshot). */
  tax_amount?: number;
  tax_lines?: { label: string; value: number }[];
  profit: number;
  payment_mode: string;
  notes: string | null;
  booking_id: string | null;
  booking_no: string | null;
  created_at: string;
  /** Set when this sale's line items were rolled into a merged bill. The row
   * is kept (never deleted) so any tab charge tagged `snack_sale:<id>` keeps a
   * traceable parent; it stops counting as its own revenue from then on. */
  merged_into_bill_id?: string | null;
  /** Soft-void flag — mirrors `SnackSale.cancelled` (see ops.ts). Set via
   * `useVoidSnackSale`; excluded from revenue/dues the same way merged sales
   * are. */
  cancelled?: boolean;
};

export type SnackComboRow = {
  id: string;
  name: string;
  items: unknown[];
  price: number;
  is_active: boolean;
  created_at: string;
};

export type BudgetRow = {
  id: string;
  month: string;
  amount: number;
  created_at: string;
};

export type RecurringExpenseRow = {
  id: string;
  title: string;
  business: string;
  category: string;
  amount: number;
  day_of_month: number;
  is_active: boolean;
  last_posted_month: string | null;
  created_at: string;
};

/**
 * A running "tab" (khata) for one customer. Balance is never stored — it is
 * always derived from tab_entries so the ledger can't drift out of sync.
 * `customer_key` is the identity used for matching (phone digits when known,
 * otherwise the lowercased name) — see lib/tabs.ts `tabKey()`.
 */
export type CustomerTabRow = {
  id: string;
  customer_key: string;
  customer_name: string;
  phone: string | null;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  created_at: string;
};

/** One charge (due added) or payment (due collected) against a tab. */
export type TabEntryRow = {
  id: string;
  tab_id: string;
  customer_key: string;
  kind: "charge" | "payment";
  /** "Turf" | "Snacks" for charges; payments carry the mode-agnostic business too. */
  business: string;
  amount: number;
  note: string | null;
  /** Optional link back to the sale/booking/bill that created this entry. */
  ref_type: string | null;
  ref_id: string | null;
  /**
   * For a `merge_reverse` entry (a source charge pulled off the tab because a
   * merged bill now owns it): the record the reversed charge belonged to, so
   * un-merging or deleting the bill can put that exact charge back.
   */
  source_ref_type?: string | null;
  source_ref_id?: string | null;
  /** How a `payment` row was received (Cash/UPI/Card); null on charges and
   * on rows saved before this field existed (treated as Cash). */
  payment_mode?: string | null;
  entry_date: string;
  created_at: string;
};

/** Small key-value store for app-wide settings (e.g. enabled slot durations). */
export type AppSettingRow = { key: string; value: unknown; updated_at: string };

/** Receipt photos are kept as blobs in IndexedDB instead of cloud storage. */
export type ReceiptRow = { path: string; blob: Blob; created_at: string };

/** Monotonic document-number counters (invoice, booking, snack bill, expense). */
export type CounterRow = { key: string; value: number; updated_at: string };

/**
 * SHA-256 of a receipt photo's bytes, recorded once at capture time
 * (`uploadReceipt` in expenses.ts) and carried alongside the photo in the
 * Telegram full backup (`telegram-backup.ts`), so a corrupted byte anywhere
 * in that transfer is caught rather than silently restored as "valid".
 * Keyed by the same relative `receipt_path` every other receipt-adjacent
 * table uses, so it needs no separate lookup table of its own. Rows saved
 * before this table existed simply have no entry here — treated as "no
 * hash recorded", the same as an older archive with no manifest checksum.
 */
export type ReceiptHashRow = {
  path: string;
  sha256: string;
  created_at: string;
};

/**
 * One row per closed business day — the record left behind by the
 * end-of-day cash-drawer reconciliation flow (Dashboard's "Close day"
 * dialog). `day` is the IST calendar key (`dayKey()` in analytics.ts) and
 * is the natural, enforced-in-code uniqueness key: closing again for a day
 * that already has a row amends that row in place (the dialog pre-fills
 * from it) rather than creating a second, conflicting record for the same
 * day. `expected_in_drawer` is a frozen snapshot of the dashboard's live
 * `cashCollectedToday - cashExpensesToday` figure at the moment of
 * closing, so a later bill/expense edit for that day can't silently
 * rewrite history the owner already signed off on.
 */
export type DayCloseRow = {
  id: string;
  day: string;
  expected_in_drawer: number;
  counted_cash: number;
  /** counted_cash - expected_in_drawer, stored (not just derived) so the
   * signed-off variance never shifts under a later edit to this row. */
  variance: number;
  note: string | null;
  closed_at: string;
  created_at: string;
};

/** One row per amendment to a day-close record — written *before* the
 * amending write overwrites `day_closes`, so re-closing a day (fixing a
 * mistyped count) never silently loses what was signed off before. Mirrors
 * `SnackStockHistoryRow`'s "one row per change" shape rather than an
 * embedded array, for the same reason: a flat, indexable audit log instead
 * of a growing field on the record it's auditing. */
export type DayCloseHistoryRow = {
  id: string;
  day: string;
  previous_expected_in_drawer: number;
  previous_counted_cash: number;
  previous_variance: number;
  previous_note: string | null;
  previous_closed_at: string;
  amended_at: string;
};

class LedgerDB extends Dexie {
  customers!: Table<CustomerRow, string>;
  bills!: Table<BillRow, string>;
  expenses!: Table<ExpenseRow, string>;
  history_entries!: Table<HistoryRow, string>;
  turf_rates!: Table<TurfRateRow, string>;
  snack_items!: Table<SnackItemRow, string>;
  snack_stock_history!: Table<SnackStockHistoryRow, string>;
  turf_bookings!: Table<TurfBookingRow, string>;
  snack_sales!: Table<SnackSaleRow, string>;
  snack_combos!: Table<SnackComboRow, string>;
  expense_budgets!: Table<BudgetRow, string>;
  recurring_expenses!: Table<RecurringExpenseRow, string>;
  receipts!: Table<ReceiptRow, string>;
  receipt_hashes!: Table<ReceiptHashRow, string>;
  counters!: Table<CounterRow, string>;
  customer_tabs!: Table<CustomerTabRow, string>;
  tab_entries!: Table<TabEntryRow, string>;
  app_settings!: Table<AppSettingRow, string>;
  day_closes!: Table<DayCloseRow, string>;
  day_close_history!: Table<DayCloseHistoryRow, string>;

  constructor() {
    super("turf-ledger");
    this.version(1).stores({
      customers: "id, name, phone, created_at",
      bills:
        "id, invoice_no, bill_date, customer_name, customer_phone, created_at",
      expenses: "id, spent_at, category, business, created_at",
      history_entries: "id, created_at",
      turf_rates: "id, slot_name, created_at",
      snack_items: "id, item_name, created_at",
      turf_bookings:
        "id, booking_no, booking_date, customer_name, phone, created_at",
      snack_sales: "id, bill_no, sale_date, customer_name, created_at",
      snack_combos: "id, name, created_at",
      expense_budgets: "id, month",
      recurring_expenses: "id, created_at",
      receipts: "path",
    });

    // v2 adds a counters store so document numbers no longer scan whole tables.
    this.version(2).stores({ counters: "key" });

    // v3 adds a stock-change audit log for the snack stock card.
    this.version(3).stores({
      snack_stock_history: "id, item_id, created_at",
    });

    // v4 adds running customer tabs (khata) for turf + snacks dues. Existing
    // rows are untouched: Dexie only creates the two new stores.
    this.version(4).stores({
      customer_tabs: "id, customer_key, status, created_at",
      tab_entries: "id, tab_id, customer_key, kind, created_at",
    });

    // v5: snack sales rolled into a merged bill are kept (not deleted) and
    // flagged instead, so their tab charges keep a valid parent. Only an
    // optional field is added — existing rows are backfilled to null so the
    // "not merged" check is the same shape everywhere.
    this.version(5)
      .stores({
        tab_entries: "id, tab_id, customer_key, kind, ref_id, created_at",
      })
      .upgrade(async (tx) => {
        await tx
          .table("snack_sales")
          .toCollection()
          .modify((s: Row) => {
            if (s["merged_into_bill_id"] === undefined)
              s["merged_into_bill_id"] = null;
          });
      });

    // v6 adds an app-wide key-value settings store (global slot durations, …).
    this.version(6).stores({ app_settings: "key" });

    // v7 adds a capture-time hash store for receipt photos, checked
    // against on restore by the Telegram full backup (telegram-backup.ts).
    // Existing receipt rows are left without a hash (nothing to backfill —
    // the original camera bytes at capture time are gone); a missing hash
    // is treated as "unverifiable", never as "corrupt".
    this.version(7).stores({ receipt_hashes: "path" });

    // v8 adds end-of-day cash-drawer close-out records (lib/day-close.ts).
    // `day` is indexed since every read/write looks a close up by its day.
    this.version(8).stores({ day_closes: "id, day, created_at" });

    // v9 adds an amendment audit log for day_closes: one row per re-close,
    // capturing what the record held immediately before being overwritten.
    this.version(9).stores({
      day_close_history: "id, day, amended_at",
    });
  }
}

export const db = new LedgerDB();

/** Tables included in a backup snapshot (receipts/blobs are excluded). */
export const DATA_TABLES = [
  "customers",
  "bills",
  "expenses",
  "history_entries",
  "turf_rates",
  "snack_items",
  "snack_stock_history",
  "turf_bookings",
  "snack_sales",
  "snack_combos",
  "expense_budgets",
  "recurring_expenses",
  "customer_tabs",
  "tab_entries",
  "app_settings",
  "day_closes",
  "day_close_history",
] as const;

export type DataTable = (typeof DATA_TABLES)[number];

export const table = (name: DataTable) =>
  db[name] as unknown as Table<Row, string>;

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const nowIso = () => new Date().toISOString();

/** Sorts a copy of `rows` by `key`; strings and numbers both work. */
export function sortBy<T extends Row>(
  rows: T[],
  key: string,
  dir: "asc" | "desc" = "asc",
) {
  return [...rows].sort((a, b) => {
    const av = a[key] ?? "";
    const bv = b[key] ?? "";
    if (av === bv) return 0;
    const cmp = av > bv ? 1 : -1;
    return dir === "asc" ? cmp : -cmp;
  });
}

/**
 * Local calendar-day key (YYYYMMDD) in the device's own timezone. Document
 * numbers embed this so an invoice/booking/bill/expense number carries the
 * date it was generated on and sorts chronologically as plain text — no need
 * to look anything else up to tell when a printed number was issued.
 */
function localDayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

const formatDailyNumber = (prefix: string, dateKey: string, seq: number) =>
  `${prefix}${dateKey}-${String(Math.max(1, Math.floor(seq))).padStart(4, "0")}`;

/**
 * Document numbers come from the `counters` store, so issuing a number is O(1)
 * even with a lakh of rows. The counter self-heals on first use each day (and
 * whenever it falls behind) by taking the highest sequence already used under
 * today's date prefix (e.g. "INV-20260903-") in the table.
 */
async function seedDailyCounter(
  dateKey: string,
  tbl: Table<Row, string>,
  field: string,
  prefix: string,
) {
  const todayPrefix = `${prefix}${dateKey}-`;
  let max = 0;
  await tbl.each((r) => {
    const v = String(r[field] ?? "");
    if (!v.startsWith(todayPrefix)) return;
    const n = Number(v.slice(todayPrefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  });
  return max;
}

/**
 * Issues the next document number for today, e.g. "INV-20260903-0007". The
 * sequence resets to 0001 at the start of each local day — a new counter key
 * (`${key}:${dateKey}`) is used per day, so previous days' counts are simply
 * left behind rather than reset in place.
 */
export async function nextNumber(
  key: string,
  tableName: DataTable,
  field: string,
  prefix: string,
) {
  const tbl = table(tableName);
  const dateKey = localDayKey();
  const counterKey = `${key}:${dateKey}`;
  const value = await db.transaction("rw", db.counters, tbl, async () => {
    const current = await db.counters.get(counterKey);
    let base =
      current?.value ?? (await seedDailyCounter(dateKey, tbl, field, prefix));
    // Guard against a counter that drifted behind the real data (restores, imports).
    const candidate = formatDailyNumber(prefix, dateKey, base + 1);
    const clash = await tbl
      .where(field)
      .equals(candidate)
      .first()
      .catch(() => undefined);
    if (clash) base = await seedDailyCounter(dateKey, tbl, field, prefix);
    const next = base + 1;
    await db.counters.put({
      key: counterKey,
      value: next,
      updated_at: nowIso(),
    });
    return next;
  });
  return formatDailyNumber(prefix, dateKey, value);
}

/** Re-seeds today's counter for every series from the data on disk (after
 * restore/archive). Past days' counters are never reused, so they're left
 * alone — each new day seeds itself lazily the first time a number is issued. */
export async function resyncCounters() {
  const specs: [string, DataTable, string, string][] = [
    ["invoice", "bills", "invoice_no", "INV-"],
    ["turf_booking", "turf_bookings", "booking_no", "INV-"],
    ["snack_bill", "snack_sales", "bill_no", "SB-"],
    ["expense", "expenses", "expense_no", "TX-"],
  ];
  const dateKey = localDayKey();
  for (const [key, t, field, prefix] of specs) {
    const value = await seedDailyCounter(dateKey, table(t), field, prefix);
    await db.counters.put({
      key: `${key}:${dateKey}`,
      value,
      updated_at: nowIso(),
    });
  }
}

export const nextInvoiceNo = async () =>
  nextNumber("invoice", "bills", "invoice_no", "INV-");
export const nextTurfBookingNo = async () =>
  nextNumber("turf_booking", "turf_bookings", "booking_no", "INV-");
export const nextSnackBillNo = async () =>
  nextNumber("snack_bill", "snack_sales", "bill_no", "SB-");
export const nextExpenseNo = async () =>
  nextNumber("expense", "expenses", "expense_no", "TX-");
