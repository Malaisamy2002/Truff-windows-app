import { rupees } from "./money";
import { useEffect, useState } from "react";

export type BackupReminder = "off" | "daily" | "weekly";

/** A single extra tax/charge beyond GST — e.g. "Service Charge", "Cess" —
 * each independently switchable and with its own rate, so a bill can carry
 * any combination of taxes on or off without touching the others. */
export type CustomTax = {
  id: string;
  label: string;
  rate: number;
  enabled: boolean;
};

export type AppSettings = {
  /**
   * Master switch for charging GST. SCOPE: when on, GST (and any enabled
   * custom tax) is added to EVERY money document — formal Bills, Turf booking
   * receipts and Snacks-only receipts alike — and every "on tab" charge posts
   * the same tax-inclusive grand total the receipt printed.
   *
   * The rate that applies is frozen on each document when it is created
   * (tax_amount / tax_lines), so changing gstEnabled or gstRate later only
   * affects NEW documents; already-issued receipts and their reprints never
   * move. Rows saved before that snapshot existed fall back to the live rate.
   */
  gstEnabled: boolean;
  gstRate: number;
  /** Independent print switch: shows the GSTIN line on bills. Separate from
   * gstEnabled above — a business can print its GSTIN without charging GST
   * on a given bill, or vice versa. */
  gstinEnabled: boolean;
  gstin: string;
  /** Independent print switch: shows the FSSAI license line on bills. */
  fssaiEnabled: boolean;
  /** FSSAI food-safety license number — printed on bills only while
   * fssaiEnabled is on. */
  fssaiNumber: string;
  /** Extra named taxes/charges on top of GST, each with its own on/off
   * switch and rate — e.g. Service Charge, Cess, Luxury Tax. */
  customTaxes: CustomTax[];
  billPrefix: string;
  billStartNo: number;
  whatsappOwner: string;
  backupReminder: BackupReminder;
  lastBackupAt: string | null;
  /** "Monthly summary on the 1st": when on, the dashboard offers to share a
   * branded statement for the just-completed month once a new month starts. */
  monthlyReportEnabled: boolean;
  /** Month key ("YYYY-MM") of the last statement the owner acknowledged —
   * dashboard banner stays quiet for that month once set. */
  monthlyReportLastSentKey: string | null;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  gstEnabled: false,
  gstRate: 18,
  gstinEnabled: false,
  gstin: "",
  fssaiEnabled: false,
  fssaiNumber: "",
  customTaxes: [],
  billPrefix: "INV-",
  billStartNo: 1,
  whatsappOwner: "",
  backupReminder: "off",
  lastBackupAt: null,
  monthlyReportEnabled: false,
  monthlyReportLastSentKey: null,
};

const KEY = "ks:app-settings";
const EVENT = "ks:app-settings";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const savedString = (value: unknown, fallback: string) =>
  typeof value === "string" ? value : fallback;

const savedBoolean = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const savedNumber = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number)
    ? Math.max(min, Math.min(max, number))
    : fallback;
};

/** Validates persisted data so an older or malformed value cannot break a Settings card. */
export function normalizeAppSettings(value: unknown): AppSettings {
  const saved = isRecord(value) ? value : {};
  const customTaxes = Array.isArray(saved["customTaxes"])
    ? saved["customTaxes"].flatMap((tax) => {
        if (!isRecord(tax)) return [];
        return [
          {
            id: savedString(tax["id"], newCustomTaxId()),
            label: savedString(tax["label"], ""),
            rate: savedNumber(tax["rate"], 0, 0, 100),
            enabled: savedBoolean(tax["enabled"], false),
          },
        ];
      })
    : DEFAULT_APP_SETTINGS.customTaxes;
  const backupReminder: BackupReminder =
    saved["backupReminder"] === "daily" ||
    saved["backupReminder"] === "weekly" ||
    saved["backupReminder"] === "off"
      ? saved["backupReminder"]
      : DEFAULT_APP_SETTINGS.backupReminder;

  return {
    gstEnabled: savedBoolean(
      saved["gstEnabled"],
      DEFAULT_APP_SETTINGS.gstEnabled,
    ),
    gstRate: savedNumber(
      saved["gstRate"],
      DEFAULT_APP_SETTINGS.gstRate,
      0,
      100,
    ),
    gstinEnabled: savedBoolean(
      saved["gstinEnabled"],
      DEFAULT_APP_SETTINGS.gstinEnabled,
    ),
    gstin: savedString(saved["gstin"], DEFAULT_APP_SETTINGS.gstin),
    fssaiEnabled: savedBoolean(
      saved["fssaiEnabled"],
      DEFAULT_APP_SETTINGS.fssaiEnabled,
    ),
    fssaiNumber: savedString(
      saved["fssaiNumber"],
      DEFAULT_APP_SETTINGS.fssaiNumber,
    ),
    customTaxes,
    billPrefix:
      savedString(
        saved["billPrefix"],
        DEFAULT_APP_SETTINGS.billPrefix,
      ).trim() || DEFAULT_APP_SETTINGS.billPrefix,
    billStartNo: Math.floor(
      savedNumber(
        saved["billStartNo"],
        DEFAULT_APP_SETTINGS.billStartNo,
        1,
        9_999_999,
      ),
    ),
    whatsappOwner: savedString(
      saved["whatsappOwner"],
      DEFAULT_APP_SETTINGS.whatsappOwner,
    ),
    backupReminder,
    lastBackupAt:
      typeof saved["lastBackupAt"] === "string" ? saved["lastBackupAt"] : null,
    monthlyReportEnabled: savedBoolean(
      saved["monthlyReportEnabled"],
      DEFAULT_APP_SETTINGS.monthlyReportEnabled,
    ),
    monthlyReportLastSentKey:
      typeof saved["monthlyReportLastSentKey"] === "string"
        ? saved["monthlyReportLastSentKey"]
        : null,
  };
}

export function readAppSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_APP_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw
      ? normalizeAppSettings(JSON.parse(raw) as unknown)
      : DEFAULT_APP_SETTINGS;
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function writeAppSettings(value: AppSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  useEffect(() => {
    const sync = () => setSettings(readAppSettings());
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return { settings, save: writeAppSettings };
}

export const formatInvoiceNo = (prefix: string, n: number) =>
  `${prefix}${String(Math.max(1, Math.floor(n))).padStart(4, "0")}`;

/** True when the user has customised numbering away from the built-in INV- sequence. */
export const hasCustomNumbering = (s: AppSettings) =>
  s.billPrefix !== DEFAULT_APP_SETTINGS.billPrefix || s.billStartNo > 1;

/** Next invoice number for a custom prefix/start, given all existing invoice numbers. */
export function nextCustomInvoiceNo(
  existing: string[],
  s: AppSettings,
): string {
  let max = s.billStartNo - 1;
  for (const no of existing) {
    if (!no.startsWith(s.billPrefix)) continue;
    const n = Number(no.slice(s.billPrefix.length).replace(/\D/g, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return formatInvoiceNo(s.billPrefix, max + 1);
}

/** Random-enough id for a new custom tax row — no backend, so this only
 * needs to be unique within one device's settings. */
export const newCustomTaxId = () =>
  `tax_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

/** Every tax currently switched on — GST plus any enabled custom tax with a
 * positive rate — normalised to one shape so the receipt can total and
 * itemise them without caring which is which. */
export function activeTaxes(
  s: Pick<AppSettings, "gstEnabled" | "gstRate" | "customTaxes">,
): { label: string; rate: number; isGst: boolean }[] {
  const list: { label: string; rate: number; isGst: boolean }[] = [];
  if (s.gstEnabled && s.gstRate > 0)
    list.push({ label: "GST", rate: s.gstRate, isGst: true });
  for (const t of s.customTaxes) {
    if (t.enabled && t.rate > 0)
      list.push({ label: t.label.trim() || "Tax", rate: t.rate, isGst: false });
  }
  return list;
}

/**
 * Adds each active tax on top of the bill's TAXABLE amount (subtotal minus
 * discount — discounts always come before tax) — a tax that's off contributes
 * nothing at all. Every tax line is rounded once to a whole rupee, and
 * `taxAmount` is the sum of those printed lines, so the receipt's lines always
 * add up to its grand total. GST keeps its conventional CGST/SGST split, split
 * so the two halves add back to the GST total exactly.
 */
export function taxBreakdown(
  taxableAmount: number,
  s: Pick<AppSettings, "gstEnabled" | "gstRate" | "customTaxes">,
): { taxAmount: number; lines: { label: string; value: number }[] } {
  const taxes = activeTaxes(s);
  const taxable = rupees(taxableAmount);
  const lines: { label: string; value: number }[] = [];
  let taxAmount = 0;
  for (const t of taxes) {
    if (t.isGst) {
      // CGST and SGST must each be rounded independently and be exactly
      // equal for an intra-state sale — never an uneven split of one
      // pre-rounded combined figure (GST portals reject a CGST/SGST
      // mismatch). Splitting a single rounded `amount` in half via
      // splitHalf() can silently produce CGST != SGST whenever the
      // combined tax rounds to an odd rupee.
      const half = rupees((taxable * t.rate) / 200);
      taxAmount += half * 2;
      lines.push({ label: `CGST @${t.rate / 2}%`, value: half });
      lines.push({ label: `SGST @${t.rate / 2}%`, value: half });
    } else {
      const amount = rupees((taxable * t.rate) / 100);
      taxAmount += amount;
      lines.push({ label: `${t.label} @${t.rate}%`, value: amount });
    }
  }
  return { taxAmount, lines };
}

const REMINDER_MS: Record<Exclude<BackupReminder, "off">, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function backupReminderDue(s: AppSettings): boolean {
  if (s.backupReminder === "off") return false;
  const interval = REMINDER_MS[s.backupReminder];
  if (!s.lastBackupAt) return true;
  const last = Date.parse(s.lastBackupAt);
  return !Number.isFinite(last) || Date.now() - last > interval;
}

/**
 * Human "Backed up …" text for the always-visible app-shell status strip
 * (AppStatusStrip.tsx). Kept as a pure function of `lastBackupAt` and `now`
 * so the thresholds are unit-testable without mocking the clock inside a
 * component. Falls back to a plain date once it's been over a week, rather
 * than an ever-growing "23 days ago".
 */
export function backupAgeLabel(
  lastBackupAt: string | null,
  now: Date = new Date(),
): string {
  if (!lastBackupAt) return "Never backed up";
  const last = Date.parse(lastBackupAt);
  if (!Number.isFinite(last)) return "Never backed up";
  const ms = now.getTime() - last;
  if (ms < 0) return "Backed up just now"; // clock skew guard
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "Backed up just now";
  if (mins < 60) return `Backed up ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Backed up ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Backed up ${days}d ago`;
  // Manual DD-MMM formatting (not toLocaleDateString) so this renders the
  // same short month name on every platform's WebView instead of drifting
  // with whatever ICU data happens to be bundled — the same reasoning
  // formatDMY (biz.ts) applies to dates, just with a month name instead of
  // a fully numeric date since this is a relative-ish "since" label.
  const d = new Date(last);
  const month = SHORT_MONTHS[d.getMonth()];
  const year =
    d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `Backed up ${String(d.getDate()).padStart(2, "0")} ${month}${year}`;
}

/**
 * "Monthly summary on the 1st" — there's no backend to run a real cron job
 * against, so this runs on app open instead: once a new calendar month
 * starts, the just-completed month becomes "due" and stays due (the
 * dashboard keeps offering it) until `monthlyReportLastSentKey` is updated,
 * which happens when the owner shares or dismisses the banner. Returns the
 * month key to report on, or null when nothing is due.
 */
export function monthlyReportDueKey(
  s: Pick<AppSettings, "monthlyReportEnabled" | "monthlyReportLastSentKey">,
  now: Date = new Date(),
): string | null {
  if (!s.monthlyReportEnabled) return null;
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const targetKey = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
  return s.monthlyReportLastSentKey === targetKey ? null : targetKey;
}
