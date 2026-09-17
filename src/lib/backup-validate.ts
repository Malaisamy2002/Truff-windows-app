import type { DataTable, Row } from "./localdb";
import { DATA_TABLES } from "./localdb";

/**
 * Per-row shape checks for a backup being restored, run before anything
 * reaches `bulkPut`/`bulkAdd` (`backup.ts`'s `restoreBackup`) or the
 * receipt-hash `bulkPut` in `telegram-backup.ts`'s `restoreFullBackup`.
 *
 * Until now, `parseBackup`/`parseFullBackupManifest` only checked the
 * envelope (`format`/`tables` presence) — a hand-edited or corrupted
 * `.db`/manifest file could carry a row missing its primary key, or with
 * the wrong type for a field the rest of the app assumes is present (e.g.
 * `amount` as a string, `items` as an object instead of an array). That
 * either throws a raw Dexie error mid-`restoreBackup` transaction — which
 * in `mode: "replace"` has already cleared the target tables, so the
 * failure leaves the ledger emptier than before the restore — or inserts a
 * row that crashes some unrelated read of the table much later, far from
 * the actual cause.
 *
 * This only checks the handful of fields serious enough to break something
 * structurally (the primary key, plus fields other code indexes into,
 * iterates as an array, or does arithmetic on). It is deliberately NOT a
 * full schema validator for every optional field — a backup from a
 * slightly older app version, missing a newer optional column, should
 * still restore cleanly. All checks run up front, before any table is
 * cleared or written to, so a bad backup fails closed with nothing touched
 * rather than partially applied.
 */

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isArr = (v: unknown): v is unknown[] => Array.isArray(v);
const isObj = (v: unknown): v is Row =>
  typeof v === "object" && v !== null && !Array.isArray(v);

type FieldCheck = readonly [
  field: string,
  check: (v: unknown) => boolean,
  mode?: "optional",
];

export type RowProblem = { index: number; reason: string };

/**
 * Runs `checks` against every row in `rows`. Only reports the FIRST failing
 * field per row (enough to say "this row is broken", not every field wrong
 * with it) so one badly-shaped row doesn't produce a wall of near-duplicate
 * messages.
 */
function checkRows(
  rows: unknown[],
  checks: readonly FieldCheck[],
): RowProblem[] {
  const problems: RowProblem[] = [];
  rows.forEach((row, index) => {
    if (!isObj(row)) {
      problems.push({ index, reason: "row is not an object" });
      return;
    }
    for (const [field, check, mode] of checks) {
      const value = row[field];
      if (mode === "optional" && value === undefined) continue;
      if (!check(value)) {
        problems.push({
          index,
          reason: `"${field}" is missing or the wrong type`,
        });
        return;
      }
    }
  });
  return problems;
}

/**
 * Field checks per `DATA_TABLES` table. Not exhaustive — see the module
 * doc comment above for what's deliberately left unchecked.
 */
const TABLE_CHECKS: Record<DataTable, readonly FieldCheck[]> = {
  customers: [
    ["id", isStr],
    ["name", isStr],
  ],
  bills: [
    ["id", isStr],
    ["invoice_no", isStr],
    ["items", isArr],
    ["subtotal", isNum],
    ["total", isNum],
    ["amount_paid", isNum],
  ],
  expenses: [
    ["id", isStr],
    ["business", isStr],
    ["category", isStr],
    ["amount", isNum],
    ["spent_at", isStr],
  ],
  history_entries: [
    ["id", isStr],
    ["rows", isArr],
    ["total", isNum],
  ],
  turf_rates: [
    ["id", isStr],
    ["slot_name", isStr],
    ["rate_per_hour", isNum],
    ["is_active", isBool],
  ],
  snack_items: [
    ["id", isStr],
    ["item_name", isStr],
    ["unit_price", isNum],
    ["cost_price", isNum],
    ["is_active", isBool],
    ["stock_quantity", isNum],
  ],
  snack_stock_history: [
    ["id", isStr],
    ["item_id", isStr],
    ["delta", isNum],
  ],
  turf_bookings: [
    ["id", isStr],
    ["booking_no", isStr],
    ["booking_date", isStr],
    ["hours", isNum],
    ["rate_per_hour", isNum],
    ["total_amount", isNum],
    ["snacks", isArr],
  ],
  snack_sales: [
    ["id", isStr],
    ["bill_no", isStr],
    ["items", isArr],
    ["total", isNum],
  ],
  snack_combos: [
    ["id", isStr],
    ["name", isStr],
    ["items", isArr],
    ["price", isNum],
  ],
  expense_budgets: [
    ["id", isStr],
    ["month", isStr],
    ["amount", isNum],
  ],
  recurring_expenses: [
    ["id", isStr],
    ["title", isStr],
    ["amount", isNum],
    ["day_of_month", isNum],
    ["is_active", isBool],
  ],
  customer_tabs: [
    ["id", isStr],
    ["customer_key", isStr],
    ["status", isStr],
  ],
  tab_entries: [
    ["id", isStr],
    ["tab_id", isStr],
    ["customer_key", isStr],
    ["kind", isStr],
    ["amount", isNum],
  ],
  app_settings: [["key", isStr]],
  day_closes: [
    ["id", isStr],
    ["day", isStr],
    ["expected_in_drawer", isNum],
    ["counted_cash", isNum],
    ["variance", isNum],
  ],
  day_close_history: [
    ["id", isStr],
    ["day", isStr],
    ["previous_expected_in_drawer", isNum],
    ["previous_counted_cash", isNum],
    ["previous_variance", isNum],
  ],
};

export type InvalidRow = { table: DataTable; index: number; reason: string };

/**
 * Validates every row of every `DATA_TABLES` table in a backup snapshot.
 * Returns the list of problems found (empty = the backup looks
 * restorable). `tables` takes the same loose shape `BackupFile["tables"]`
 * and `FullBackup["tables"]` already share, so it works for both.
 */
export function findInvalidRows(
  tables: Record<string, unknown[] | undefined>,
): InvalidRow[] {
  const problems: InvalidRow[] = [];
  for (const t of DATA_TABLES) {
    const rows = tables[t] ?? [];
    for (const p of checkRows(rows, TABLE_CHECKS[t]))
      problems.push({ table: t, ...p });
  }
  return problems;
}

/** One line summarizing every problem found, for an error toast. */
export function describeInvalidRows(problems: InvalidRow[]): string {
  const byTable = new Map<DataTable, number>();
  for (const p of problems)
    byTable.set(p.table, (byTable.get(p.table) ?? 0) + 1);
  const parts = [...byTable.entries()]
    .map(([t, n]) => `${n} in ${t}`)
    .join(", ");
  return `This backup has ${problems.length} row${
    problems.length === 1 ? "" : "s"
  } that don't look right (${parts}) — nothing was restored.`;
}

const RECEIPT_HASH_CHECKS: readonly FieldCheck[] = [
  ["path", isStr],
  ["sha256", isStr],
];

/** Same shape check as `findInvalidRows`, for the `receipt_hashes` rows a
 *  full Telegram backup restores separately (they aren't in `DATA_TABLES`). */
export function findInvalidReceiptHashRows(rows: unknown[]): RowProblem[] {
  return checkRows(rows, RECEIPT_HASH_CHECKS);
}

const PHOTO_CHECKS: readonly FieldCheck[] = [
  ["path", isStr],
  ["data", isStr],
  ["created_at", isStr],
];

/** Same shape check, for the inline base64 `photos[]` a version-2 local
 *  `.db` backup carries (`BackupPhoto` in backup.ts). */
export function findInvalidPhotoRows(rows: unknown[]): RowProblem[] {
  return checkRows(rows, PHOTO_CHECKS);
}
