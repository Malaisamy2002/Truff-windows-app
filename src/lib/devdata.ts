import { db, DATA_TABLES, nowIso, resyncCounters, table } from "./localdb";

/**
 * Dev/maintenance helper: wipes transactional data from the local database.
 * (The old 1,00,000-record load-test generator has been removed — it wrote
 * synthetic rows straight into live data.)
 */
export async function clearTestData() {
  await db.turf_bookings.clear();
  await db.snack_sales.clear();
  await db.expenses.clear();
  await db.counters.clear();
  await db.counters.put({ key: "invoice", value: 0, updated_at: nowIso() });
  await resyncCounters();
}

/**
 * Settings "danger zone" reset: wipes every local table — customers, bills,
 * bookings, sales, expenses, tabs, rates/menu, branding/print settings,
 * saved receipts, everything — and reseeds the invoice/booking counters back
 * to zero. Irreversible; the confirming UI should warn the person to take a
 * backup first.
 */
export async function clearAllData() {
  await db.transaction(
    "rw",
    [...DATA_TABLES.map((t) => table(t)), db.receipts, db.counters],
    async () => {
      for (const t of [...DATA_TABLES].reverse()) {
        await table(t).clear();
      }
      await db.receipts.clear();
      await db.counters.clear();
    },
  );
  await resyncCounters();
}
