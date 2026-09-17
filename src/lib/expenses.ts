import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bolt,
  Wrench,
  Package,
  Home,
  Users,
  Truck,
  Dumbbell,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { db, newId, nextExpenseNo, nowIso, sortBy } from "./localdb";
import { readCache, writeCache } from "./data";
import { monthKey as monthKeyCore, dayKey } from "./analytics";
import {
  appDocumentAbsPath,
  appDocumentExists,
  isAndroid,
  isDesktop,
  readAppDocument,
  removeAppDocument,
  saveExportFile,
  saveToAppDocuments,
} from "./desktop";
import { compressReceiptImage, isLikelyImageFile } from "./image";
import { sha256Hex } from "./receipts-share";

/** Icon shown next to each expense category. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Electricity: Bolt,
  Maintenance: Wrench,
  "Raw Material": Package,
  Rent: Home,
  "Staff Wages": Users,
  Transport: Truck,
  Equipment: Dumbbell,
  Other: Receipt,
};

export const categoryIcon = (category: string): LucideIcon =>
  CATEGORY_ICONS[category] ?? Receipt;

/**
 * "2026-08" for the month a date falls in, read off the LOCAL calendar.
 * Defaults to the current month when called with no argument.
 *
 * This is a thin wrapper around `monthKey` in `analytics.ts` — that used to
 * be a separate, buggy re-implementation here (using `.toISOString()`,
 * which reads UTC and misreads the month for ~5.5 hours after local
 * midnight on the 1st of every month in IST). Kept as a local export, with
 * its default-argument convenience, so existing call sites don't change.
 */
export const monthKey = (d: Date | string = new Date()) => monthKeyCore(d);

/* ------------------------------- budgets -------------------------------- */

export type Budget = { id: string; month: string; amount: number };

export function useBudgets() {
  return useQuery({
    queryKey: ["expense_budgets"],
    initialData: () => readCache<Budget[]>("expense_budgets", []),
    queryFn: async () => {
      const rows = sortBy(
        await db.expense_budgets.toArray(),
        "month",
        "desc",
      ).map((b) => ({
        id: b.id,
        month: b.month,
        amount: Number(b.amount),
      }));
      writeCache("expense_budgets", rows);
      return rows;
    },
  });
}

export function useSetBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { month: string; amount: number }) => {
      const existing = await db.expense_budgets
        .where("month")
        .equals(payload.month)
        .first();
      if (existing) {
        await db.expense_budgets.update(existing.id, {
          amount: payload.amount,
        });
      } else {
        await db.expense_budgets.add({
          id: newId(),
          month: payload.month,
          amount: payload.amount,
          created_at: nowIso(),
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expense_budgets"] }),
  });
}

/* --------------------------- recurring expenses -------------------------- */

export type RecurringExpense = {
  id: string;
  title: string;
  business: string;
  category: string;
  amount: number;
  day_of_month: number;
  is_active: boolean;
  last_posted_month: string | null;
};

export function useRecurringExpenses() {
  return useQuery({
    queryKey: ["recurring_expenses"],
    initialData: () => readCache<RecurringExpense[]>("recurring_expenses", []),
    queryFn: async () => {
      const rows = sortBy(
        await db.recurring_expenses.toArray(),
        "created_at",
        "desc",
      ).map((r) => ({
        id: r.id,
        title: r.title,
        business: r.business,
        category: r.category,
        amount: Number(r.amount),
        day_of_month: r.day_of_month,
        is_active: r.is_active,
        last_posted_month: r.last_posted_month,
      }));
      writeCache("recurring_expenses", rows);
      return rows;
    },
  });
}

export function useAddRecurringExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      title: string;
      business: string;
      category: string;
      amount: number;
      day_of_month: number;
    }) => {
      await db.recurring_expenses.add({
        id: newId(),
        ...payload,
        is_active: true,
        last_posted_month: null,
        created_at: nowIso(),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring_expenses"] }),
  });
}

export function useToggleRecurringExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; is_active: boolean }) => {
      await db.recurring_expenses.update(payload.id, {
        is_active: payload.is_active,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring_expenses"] }),
  });
}

export function useDeleteRecurringExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await db.recurring_expenses.delete(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring_expenses"] }),
  });
}

/**
 * Pure plan for one auto-posting run: which rules are due on `now`, and the
 * plain "YYYY-MM-DD" each post should carry. Extracted from the mutation so
 * the date rules are unit-testable without a database.
 *
 * Date rules:
 * - Month and day-of-month come from the IST calendar (monthKey/dayKey), NOT
 *   `now.getDate()` — that reads the runtime's local timezone and disagrees
 *   with monthKey() anywhere not already set to IST.
 * - `spent_at` is a plain local date, matching every other expense row. It
 *   used to be `spent.toISOString()` — a full UTC timestamp that plain-date
 *   equality filters (ExpensesTab day filter, uploadReceipt folder) silently
 *   never matched.
 * - A rule for "the 31st" posts on the LAST day of shorter months (clamped),
 *   never rolls over into the next month like the Date constructor did.
 */
export function planRecurringPosts(
  rules: RecurringExpense[],
  now: Date = new Date(),
): { rule: RecurringExpense; spent_at: string }[] {
  const month = monthKey(now); // IST month key
  const todayDay = Number(dayKey(now).slice(8, 10));
  const [y = 0, mo = 1] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate(); // clamp e.g. the 31st in Feb
  return rules
    .filter(
      (r) =>
        r.is_active &&
        r.last_posted_month !== month &&
        todayDay >= Math.min(r.day_of_month, lastDay),
    )
    .map((rule) => ({
      rule,
      spent_at: `${month}-${String(Math.min(rule.day_of_month, lastDay)).padStart(2, "0")}`,
    }));
}

/**
 * Posts every active recurring expense whose day has arrived this month and
 * which hasn't been posted yet. Returns how many were added.
 */
export function useRunRecurringExpenses() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rules: RecurringExpense[]) => {
      const now = new Date();
      const month = monthKey(now);
      const due = planRecurringPosts(rules, now);
      if (due.length === 0) return 0;
      for (const { rule: r, spent_at } of due) {
        const expense_no = await nextExpenseNo();
        await db.expenses.add({
          id: newId(),
          expense_no,
          business: r.business,
          category: r.category,
          description: r.title,
          note: "Auto-added recurring expense",
          amount: r.amount,
          spent_at,
          receipt_path: null,
          created_at: nowIso(),
        });
        await db.recurring_expenses.update(r.id, { last_posted_month: month });
      }
      return due.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses_v2"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["recurring_expenses"] });
    },
  });
}

/* -------------------------------- receipts -------------------------------
 *
 * Web/PWA build: photos are stored as blobs inside the app's IndexedDB
 * (`db.receipts`), keyed by a generated path. Fine for a browser sandbox,
 * but on the desktop build it bloats the app's database file with binary
 * data the OS can't see or back up on its own.
 *
 * Desktop (Tauri) build: photos are instead written as real files on disk,
 * under `Documents/TurfApp/Receipts/<YYYY-MM-DD>/` — one subfolder per
 * expense date, right where the person can find it in Explorer (not buried
 * in the hidden AppData folder). Nothing is created until an expense
 * actually has a photo attached: no date folder is made in advance, and a
 * day with no expenses never gets one. `receipt_path` on the expense row
 * always stores the relative path (`Receipts/2026-09-04/xxxx.jpg`); on
 * desktop that's resolved against `Documents/TurfApp`, on web it's the
 * IndexedDB key, so the rest of the app never needs to know which mode it's
 * in.
 * ------------------------------------------------------------------------ */

/**
 * Stores a receipt photo for the given expense date and returns its
 * relative path (`Receipts/<date>/<id>.<ext>`).
 *
 * `date` should be the expense's `spent_at` (YYYY-MM-DD); it's only used to
 * pick the subfolder name on desktop and is ignored on web.
 */
export async function uploadReceipt(
  file: File,
  date: string = dayKey(new Date()),
) {
  // `accept="image/*"` on the file input (ExpensesTab.tsx) is only a UI
  // hint — the browser derives it from the file's extension, not its
  // contents, so a renamed non-image file (e.g. a `.exe` saved as
  // `receipt.jpg`) passes it unchanged. `compressReceiptImage` below
  // quietly falls back to storing the *original* file if the browser's
  // <img> decoder fails on it, which would otherwise let exactly that file
  // through into storage as a "receipt". Check the actual bytes first and
  // refuse anything that isn't a real image before it ever reaches
  // compression or storage.
  if (!(await isLikelyImageFile(file))) {
    throw new Error(
      "That file doesn't look like an image and can't be saved as a receipt.",
    );
  }

  // Resize/re-encode before storing — see compressReceiptImage's doc
  // comment for why (camera captures are otherwise 3-4MB+ each, and this
  // app is meant to hold tens of thousands of these). Falls back to the
  // original file untouched if compression fails for any reason, so a
  // decode error never blocks saving the expense.
  const stored = await compressReceiptImage(file);
  const ext = stored.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `Receipts/${date}/${newId()}.${ext}`;
  const bytes = new Uint8Array(await stored.arrayBuffer());

  // Record a hash of exactly what's being stored, right now, before it's
  // written anywhere — carried alongside the photo in the Telegram full
  // backup (telegram-backup.ts) so a corrupted byte introduced on-disk
  // between capture and a later backup/restore is caught, not silently
  // carried forward as "valid".
  const sha256 = await sha256Hex(bytes);
  await db.receipt_hashes.put({ path, sha256, created_at: nowIso() });

  // Always keep a copy in the local database (Dexie/IndexedDB), on every
  // platform — not just the browser/PWA build. This is what makes the
  // single-file `.db` backup in backup.ts fully self-contained with photos
  // included, instead of needing a separate "Import receipt photos" .zip
  // step, and gives `openReceipt` a fallback copy to self-heal from if the
  // on-disk file is ever missing (e.g. right after restoring a backup on a
  // fresh install, before any file has been written to disk yet).
  const blob = stored.slice(0, stored.size, stored.type || "image/jpeg");
  await db.receipts.put({ path, blob, created_at: nowIso() });

  if (isDesktop()) {
    // Desktop/Android additionally get a real file on disk — see the
    // module doc comment above for why (Explorer/OS-viewer visibility).
    await saveToAppDocuments(path, bytes);
  }
  return path;
}

/**
 * Removes a photo `uploadReceipt` wrote straight to the database but that
 * never ended up attached to a saved expense — the person picked a
 * different photo before submitting the form, or closed it without
 * submitting at all. Clears every copy `uploadReceipt` could have made:
 * `receipts`, `receipt_hashes`, and — on desktop/Android — the on-disk file
 * under `Documents/TurfApp`. The disk removal is best-effort and never
 * throws (see `removeAppDocument`'s doc comment), so a failed native fs
 * call there can't block the Dexie cleanup, which is the part that matters
 * for `db.receipts` no longer holding a photo nothing points to.
 */
export async function deleteReceipt(path: string): Promise<void> {
  await db.receipts.delete(path);
  await db.receipt_hashes.delete(path);
  if (isDesktop()) await removeAppDocument(path);
}

/**
 * Opens a stored receipt for viewing.
 *
 * Desktop (excluding Android): hands the absolute file path to the OS's
 * default photo viewer (via `tauri-plugin-opener`) — no browser tab/popup
 * involved, so it can't get silently blocked the way `window.open` can.
 *
 * Android: `tauri-plugin-opener`'s `openPath()` only supports opening URLs
 * on Android, not local file paths — calling it with a path there throws
 * every time (confirmed against Tauri's own platform-support docs), so
 * "View receipt" would otherwise error out unconditionally. The receipt
 * photo also lives in the app's private storage (see `uploadReceipt`
 * above), which isn't something `ACTION_VIEW` can open directly without a
 * content provider anyway. Both problems are solved the same way exports
 * solve theirs: read the private bytes back out and hand them to the
 * `android-save` plugin with `openAfterSave`, which writes a copy into the
 * public Downloads folder via MediaStore and immediately opens it through
 * the OS viewer via a `content://` URI it already knows how to grant.
 *
 * Web: returns a blob Object URL for the caller to `window.open`/render;
 * revoke it when done.
 */

/**
 * The exact message `openReceipt` throws when the photo simply isn't on
 * this device (as opposed to some other failure, e.g. a save-plugin error
 * on Android). Exported so callers — and `missingReceiptMessage` below —
 * can tell that specific case apart from any other error without guessing
 * at string contents.
 */
export const RECEIPT_NOT_FOUND_MESSAGE = "Receipt not found on this device";

/**
 * Reads a receipt's bytes back out of the Dexie fallback copy `uploadReceipt`
 * always writes (see its doc comment). Used below when the on-disk file is
 * missing — e.g. right after restoring a `.db` backup that included photos,
 * before this specific device has ever written that file itself.
 */
async function readReceiptFromDexie(path: string): Promise<Uint8Array | null> {
  const row = await db.receipts.get(path);
  if (!row) return null;
  return new Uint8Array(await row.blob.arrayBuffer());
}

export async function openReceipt(path: string): Promise<string | null> {
  if (isAndroid()) {
    const bytes: Uint8Array | null = (await appDocumentExists(path))
      ? await readAppDocument(path)
      : await readReceiptFromDexie(path);
    if (!bytes) throw new Error(RECEIPT_NOT_FOUND_MESSAGE);
    const ext = path.split(".").pop()?.toLowerCase() || "jpg";
    const mimeType =
      ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : "image/jpeg";
    const fileName = path.split("/").pop() || `receipt.${ext}`;
    const result = await saveExportFile(bytes, fileName, mimeType, true);
    if (!result.saved)
      throw new Error(result.error ?? "Could not open this receipt");
    return null; // opened natively — nothing for the caller to display
  }

  if (isDesktop()) {
    if (!(await appDocumentExists(path))) {
      // Self-heal: write the Dexie fallback copy to disk now, so this and
      // every future open of the same receipt on this device goes through
      // the normal on-disk path.
      const bytes = await readReceiptFromDexie(path);
      if (!bytes) throw new Error(RECEIPT_NOT_FOUND_MESSAGE);
      await saveToAppDocuments(path, bytes);
    }
    const abs = await appDocumentAbsPath(path);
    const { openPath } = await import("@tauri-apps/plugin-opener");
    await openPath(abs);
    return null; // opened natively — nothing for the caller to display
  }

  const row = await db.receipts.get(path);
  if (!row) throw new Error(RECEIPT_NOT_FOUND_MESSAGE);
  return URL.createObjectURL(row.blob);
}

/** @deprecated use `openReceipt`, which now handles both platforms. */
export const receiptUrl = openReceipt;

/**
 * Turns an `openReceipt` failure into a toast message. When the failure is
 * specifically "the photo isn't on this device" (see
 * `RECEIPT_NOT_FOUND_MESSAGE`), the message names the expense's reference
 * number so the person knows which receipt to look for, and points at the
 * two ways a photo can actually come back: restoring the single-file `.db`
 * backup (Settings → Backup & restore) or the Telegram full backup
 * (Settings → Cloud backup (Telegram)) — both embed every receipt photo, so
 * either one can recover it if it was ever backed up from a device that had
 * it. There's no separate "import receipts" step anymore; a single restore
 * covers photos too (see backup.ts / telegram-backup.ts).
 * Any other error (e.g. a genuine Android save-plugin failure) is passed
 * through unchanged, since it isn't a missing-photo case.
 */
export function missingReceiptMessage(
  error: Error,
  expenseNo: string | null,
): string {
  if (error.message !== RECEIPT_NOT_FOUND_MESSAGE) return error.message;
  const label = expenseNo ? `Receipt ${expenseNo}` : "This receipt";
  return `${label} — photo not on this device. Restoring a backup that has it (Settings → Backup & restore, or Cloud backup (Telegram)) will bring it back.`;
}
