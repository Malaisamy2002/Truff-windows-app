import { type BackupTable } from "@/lib/backup";

/** Friendly labels for the details disclosure only — `backupSummary()`'s
 * toast text still uses raw table names, unchanged, so this doesn't affect
 * anything but this dialog. Shared by `BackupCard` and `TelegramBackupCard`
 * so their matching table-by-table breakdowns use the exact same wording
 * instead of a second hand-maintained copy. */
export const TABLE_LABELS: Partial<Record<BackupTable, string>> = {
  customers: "Customers",
  bills: "Bills",
  expenses: "Expenses",
  history_entries: "History entries",
  turf_rates: "Turf rates",
  snack_items: "Snack items",
  snack_stock_history: "Snack stock history",
  turf_bookings: "Turf bookings",
  snack_sales: "Snack sales",
  snack_combos: "Snack combos",
  expense_budgets: "Expense budgets",
  recurring_expenses: "Recurring expenses",
  customer_tabs: "Customer tabs",
  tab_entries: "Tab entries",
  app_settings: "App settings",
  day_closes: "Day closes",
  day_close_history: "Day close amendments",
};
