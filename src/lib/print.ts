import { useEffect, useState } from "react";
import {
  DEFAULT_BACKGROUND,
  DEFAULT_LOGO,
  DEFAULT_ROLL_HEADER,
} from "./branding-assets";
import { DEFAULT_UPI_APPS, UPI_APP_IDS, type UpiAppId } from "./receipt-upi";

/**
 * Paper/printer catalogue. "roll" papers are thermal receipt rolls whose
 * page height grows with the content (no fixed page size); "sheet" papers
 * are regular cut-sheet printers (inkjet/laser) with a fixed page height.
 * "custom" is a roll paper whose width comes from `PrintSettings.customWidthMm`
 * instead of `widthMm` here, for POS printers that don't match a common size.
 */
export const PAPER_TYPES = [
  { id: "50mm", label: 'Thermal 2" (50 mm)', widthMm: 50, kind: "roll" },
  { id: "58mm", label: "Thermal 58 mm", widthMm: 58, kind: "roll" },
  { id: "76mm", label: 'Thermal 3" (76 mm)', widthMm: 76, kind: "roll" },
  { id: "80mm", label: "Thermal 80 mm (default)", widthMm: 80, kind: "roll" },
  { id: "custom", label: "Custom thermal width…", widthMm: 80, kind: "roll" },
  { id: "a5", label: "A5 sheet", widthMm: 148, heightMm: 210, kind: "sheet" },
  { id: "a4", label: "A4 sheet", widthMm: 210, heightMm: 297, kind: "sheet" },
  {
    id: "letter",
    label: "Letter sheet (US)",
    widthMm: 215.9,
    heightMm: 279.4,
    kind: "sheet",
  },
] as const;

export type PaperId = (typeof PAPER_TYPES)[number]["id"];
export type PaperKind = (typeof PAPER_TYPES)[number]["kind"];

export function paperInfo(
  paper: PaperId,
): (typeof PAPER_TYPES)[number] & { heightMm?: number } {
  return (
    PAPER_TYPES.find((p) => p.id === paper) ??
    PAPER_TYPES.find((p) => p.id === "80mm")!
  );
}

export function isRollPaper(paper: PaperId) {
  return paperInfo(paper).kind === "roll";
}

/** Print darkness — mirrors the "density"/"darkness" dial on real thermal
 * printers, and gently lightens/darkens sheet printers too. */
export const DENSITY_OPTIONS = [
  { id: "light", label: "Light (saves ribbon/ink)" },
  { id: "normal", label: "Normal" },
  { id: "dark", label: "Dark / bold" },
] as const;
export type DensityId = (typeof DENSITY_OPTIONS)[number]["id"];

/** Space between printed lines. */
export const LINE_SPACING_OPTIONS = [
  { id: "compact", label: "Compact" },
  { id: "normal", label: "Normal" },
  { id: "relaxed", label: "Relaxed" },
] as const;
export type LineSpacingId = (typeof LINE_SPACING_OPTIONS)[number]["id"];

/** The print paths the Print button can take — see `printMethod` below. */
export const PRINT_METHOD_OPTIONS = [
  { id: "system", label: "Default print (printer dialog)" },
  { id: "pdf", label: "PDF print (open as PDF)" },
  {
    id: "named-printer",
    label: "Chosen printer (no dialog)",
  },
] as const;
export type PrintMethod = (typeof PRINT_METHOD_OPTIONS)[number]["id"];

/** Ready-made setting bundles for common printer hardware, so the person
 * doesn't have to work out width/density/spacing by hand. Applied on top of
 * (merged with) whatever is already saved. */
export const PRINTER_PRESETS: {
  id: string;
  label: string;
  settings: Partial<PrintSettings>;
}[] = [
  {
    id: "generic-58",
    label: "Generic thermal — 58 mm",
    settings: {
      paper: "58mm",
      density: "normal",
      lineSpacing: "compact",
      cutFeedMm: 6,
    },
  },
  {
    id: "generic-80",
    label: "Generic thermal — 80 mm",
    settings: {
      paper: "80mm",
      density: "normal",
      lineSpacing: "normal",
      cutFeedMm: 8,
    },
  },
  {
    id: "escpos-80",
    label: "Epson/Star-style auto-cutter — 80 mm",
    settings: {
      paper: "80mm",
      density: "dark",
      lineSpacing: "normal",
      cutFeedMm: 16,
    },
  },
  {
    id: "mobile-58",
    label: "Portable Bluetooth printer — 58 mm (via its Windows driver)",
    settings: {
      paper: "58mm",
      density: "dark",
      lineSpacing: "compact",
      cutFeedMm: 4,
    },
  },
  {
    id: "a5-sheet",
    label: "A5 sheet (inkjet/laser)",
    settings: {
      paper: "a5",
      density: "normal",
      lineSpacing: "normal",
      cutFeedMm: 0,
    },
  },
  {
    id: "a4-sheet",
    label: "A4 sheet (inkjet/laser)",
    settings: {
      paper: "a4",
      density: "normal",
      lineSpacing: "normal",
      cutFeedMm: 0,
    },
  },
  {
    id: "letter-sheet",
    label: "Letter sheet (US office printer)",
    settings: {
      paper: "letter",
      density: "normal",
      lineSpacing: "normal",
      cutFeedMm: 0,
    },
  },
];

export type PrintSettings = {
  paper: PaperId;
  /** Roll width in mm, used only when paper === "custom". */
  customWidthMm: number;
  fontScale: number;
  copies: number;
  shopName: string;
  /** Shop address printed under the shop name (blank = not printed). */
  shopAddress: string;
  /** Shop contact number printed in the receipt header (blank = not printed). */
  shopPhone: string;
  /** Shop email printed under the phone in the receipt header (blank = not printed). */
  shopEmail: string;
  /** Side margin in mm. 0 = automatic (5 mm on rolls, 12 mm on sheets). */
  marginMm: number;
  /** Where body content begins below a full-page A4 letterhead background. */
  a4ContentTopMm: number;
  /** Currency prefix used for amounts on the PDF, e.g. "Rs" or "$". */
  currencySymbol: string;
  headerLine: string;
  footerLine: string;
  showPhone: boolean;
  autoPrint: boolean;
  logo: StoredImage;
  banner: StoredImage;
  /** Full-bleed A4 letterhead artwork (header + footer baked in). Takes over
   * the whole sheet page for "a4" paper when present, replacing the banner
   * and the plain-text shop name/address/phone header. */
  background: StoredImage;
  /** Full-width thermal receipt header artwork (shop name/address/phone/
   * "BILL" title baked in) for roll paper, replacing the logo and the
   * plain-text header on thermal printouts when present. */
  rollHeader: StoredImage;
  showLogo: boolean;
  /** Print darkness — light/normal/dark. */
  density: DensityId;
  /** Space between printed lines — compact/normal/relaxed. */
  lineSpacing: LineSpacingId;
  /** Extra blank feed (mm) left at the bottom of roll-paper receipts, so an
   * auto-cutter doesn't slice through the last line. Ignored for sheets. */
  cutFeedMm: number;
  /** Which print path the Print button uses — the person picks exactly one,
   * so pressing Print never juggles two different windows at once.
   * "system" sends the receipt straight to the real printer dialog (the
   * rasterised-image print path on desktop, or the OS/browser print sheet
   * elsewhere). "pdf" skips the printer dialog entirely and opens the
   * receipt as a PDF instead, so the person can print it from their own PDF
   * viewer (or just save/share it). */
  printMethod: PrintMethod;
  /** Name of the Windows printer to send jobs to when `printMethod` is
   * `"named-printer"`, exactly as reported by `listAvailablePrinters()`
   * (see `printers.ts`). Blank = none chosen yet — that print method then
   * fails with a clear "choose one" message rather than guessing. */
  selectedPrinter: string;
  /** "classic" = the original plain ruled-line layout.
   * "premium" = the boxed/colored letterhead-style layout (navy+gold A4,
   * compact A5, boxed color/B&W thermal receipts, condensed 58mm POS slip)
   * — see receipt-premium.ts. Falls back to "classic" for any paper size
   * the premium renderer doesn't have a dedicated layout for (e.g. Letter).
   * Premium is the out-of-the-box default so new installs match the branded
   * invoice design; classic remains available as an explicit setting. */
  templateStyle: "classic" | "premium";
  /** UPI ID (VPA) used to render the "Scan & Pay" QR code on the premium
   * A4/A5/color-roll layouts. Blank = QR/payment box is not drawn. */
  upiId: string;
  /** Which UPI app chips to show under the QR (editable — the shop picks
   * whichever apps their customers actually use). Defaults to GPay +
   * PhonePe; empty/corrupted settings fall back to the same default. */
  upiApps: UpiAppId[];
  /** Color scheme for the premium 80mm layout only — real thermal rolls are
   * monochrome hardware ("bw", the default and the safer choice for actual
   * printing); "color" is for a shop with a genuine color receipt printer,
   * or for a PDF/WhatsApp copy that's meant to be viewed on a screen rather
   * than printed. A4/A5 are always full color; 58/50mm always render in
   * plain black (too narrow for the boxed color treatment to read well). */
  thermalColorMode: "bw" | "color";
};

/** A branding image kept small (resized client-side before storage) with its
 * aspect ratio, so the PDF can size it correctly without re-loading the file. */
export type StoredImage = {
  dataUrl: string;
  width: number;
  height: number;
} | null;

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paper: "80mm",
  customWidthMm: 72,
  fontScale: 1,
  copies: 1,
  shopName: "Chennai Soccer & Sports School",
  shopAddress:
    "Second Floor, Pasumpon Devar Mandapam, 158/100, Habibullah Rd, Parthasarathy Puram, T. Nagar, Chennai, Tamil Nadu 600017",
  shopPhone: "+91 93611 15939",
  shopEmail: "chennaisoccerschool@gmail.com",
  marginMm: 0,
  a4ContentTopMm: 68,
  currencySymbol: "Rs",
  headerLine: "Play | Train | Grow",
  footerLine: "Thank you! Visit again.",
  showPhone: true,
  autoPrint: false,
  logo: DEFAULT_LOGO,
  banner: null,
  background: DEFAULT_BACKGROUND,
  rollHeader: DEFAULT_ROLL_HEADER,
  showLogo: true,
  density: "normal",
  lineSpacing: "normal",
  cutFeedMm: 0,
  printMethod: "system",
  selectedPrinter: "",
  templateStyle: "premium",
  upiId: "",
  upiApps: DEFAULT_UPI_APPS,
  thermalColorMode: "bw",
};

const KEY = "ks:print-settings";
const PREMIUM_DEFAULT_MIGRATION_KEY = "ks:premium-template-default-v1";

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
const savedImage = (value: unknown, fallback: StoredImage): StoredImage => {
  if (value === null) return null;
  if (!isRecord(value)) return fallback;
  const dataUrl = value["dataUrl"];
  const width = value["width"];
  const height = value["height"];
  if (
    typeof dataUrl !== "string" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return fallback;
  return { dataUrl, width, height };
};

/** Keeps persisted printer values valid for every Settings control and PDF layout. */
export function normalizePrintSettings(value: unknown): PrintSettings {
  const saved = isRecord(value) ? value : {};
  const paper = PAPER_TYPES.some((item) => item.id === saved["paper"])
    ? (saved["paper"] as PaperId)
    : DEFAULT_PRINT_SETTINGS.paper;
  const density = DENSITY_OPTIONS.some((item) => item.id === saved["density"])
    ? (saved["density"] as DensityId)
    : DEFAULT_PRINT_SETTINGS.density;
  const lineSpacing = LINE_SPACING_OPTIONS.some(
    (item) => item.id === saved["lineSpacing"],
  )
    ? (saved["lineSpacing"] as LineSpacingId)
    : DEFAULT_PRINT_SETTINGS.lineSpacing;
  const templateStyle =
    saved["templateStyle"] === "premium" || saved["templateStyle"] === "classic"
      ? (saved["templateStyle"] as PrintSettings["templateStyle"])
      : DEFAULT_PRINT_SETTINGS.templateStyle;
  const thermalColorMode =
    saved["thermalColorMode"] === "color" || saved["thermalColorMode"] === "bw"
      ? (saved["thermalColorMode"] as PrintSettings["thermalColorMode"])
      : DEFAULT_PRINT_SETTINGS.thermalColorMode;
  // Migrates the old `previewBeforePrint` boolean (pre-toggle installs) to
  // the new two-way `printMethod` choice: an existing "on" preview setting
  // becomes explicit "pdf", anything else keeps the printer-dialog default.
  const printMethod = PRINT_METHOD_OPTIONS.some(
    (item) => item.id === saved["printMethod"],
  )
    ? (saved["printMethod"] as PrintMethod)
    : saved["previewBeforePrint"] === true
      ? "pdf"
      : DEFAULT_PRINT_SETTINGS.printMethod;
  const savedUpiApps = Array.isArray(saved["upiApps"])
    ? (saved["upiApps"] as unknown[]).filter((v): v is UpiAppId =>
        UPI_APP_IDS.includes(v as UpiAppId),
      )
    : [];
  const upiApps = savedUpiApps.length
    ? savedUpiApps
    : DEFAULT_PRINT_SETTINGS.upiApps;
  return {
    paper,
    customWidthMm: savedNumber(
      saved["customWidthMm"],
      DEFAULT_PRINT_SETTINGS.customWidthMm,
      50,
      300,
    ),
    fontScale: savedNumber(
      saved["fontScale"],
      DEFAULT_PRINT_SETTINGS.fontScale,
      0.7,
      1.5,
    ),
    copies: Math.round(
      savedNumber(saved["copies"], DEFAULT_PRINT_SETTINGS.copies, 1, 5),
    ),
    shopName: savedString(saved["shopName"], DEFAULT_PRINT_SETTINGS.shopName),
    shopAddress: savedString(
      saved["shopAddress"],
      DEFAULT_PRINT_SETTINGS.shopAddress,
    ),
    shopPhone: savedString(
      saved["shopPhone"],
      DEFAULT_PRINT_SETTINGS.shopPhone,
    ),
    shopEmail: savedString(
      saved["shopEmail"],
      DEFAULT_PRINT_SETTINGS.shopEmail,
    ),
    marginMm: savedNumber(
      saved["marginMm"],
      DEFAULT_PRINT_SETTINGS.marginMm,
      0,
      40,
    ),
    a4ContentTopMm: savedNumber(
      saved["a4ContentTopMm"],
      DEFAULT_PRINT_SETTINGS.a4ContentTopMm,
      40,
      140,
    ),
    currencySymbol: savedString(
      saved["currencySymbol"],
      DEFAULT_PRINT_SETTINGS.currencySymbol,
    ).slice(0, 4),
    headerLine: savedString(
      saved["headerLine"],
      DEFAULT_PRINT_SETTINGS.headerLine,
    ),
    footerLine: savedString(
      saved["footerLine"],
      DEFAULT_PRINT_SETTINGS.footerLine,
    ),
    showPhone: savedBoolean(
      saved["showPhone"],
      DEFAULT_PRINT_SETTINGS.showPhone,
    ),
    autoPrint: savedBoolean(
      saved["autoPrint"],
      DEFAULT_PRINT_SETTINGS.autoPrint,
    ),
    logo: savedImage(saved["logo"], DEFAULT_PRINT_SETTINGS.logo),
    banner: savedImage(saved["banner"], DEFAULT_PRINT_SETTINGS.banner),
    background: savedImage(
      saved["background"],
      DEFAULT_PRINT_SETTINGS.background,
    ),
    rollHeader: savedImage(
      saved["rollHeader"],
      DEFAULT_PRINT_SETTINGS.rollHeader,
    ),
    showLogo: savedBoolean(saved["showLogo"], DEFAULT_PRINT_SETTINGS.showLogo),
    density,
    lineSpacing,
    cutFeedMm: savedNumber(
      saved["cutFeedMm"],
      DEFAULT_PRINT_SETTINGS.cutFeedMm,
      0,
      40,
    ),
    printMethod,
    selectedPrinter: savedString(
      saved["selectedPrinter"],
      DEFAULT_PRINT_SETTINGS.selectedPrinter,
    ).slice(0, 200),
    templateStyle,
    upiId: savedString(saved["upiId"], DEFAULT_PRINT_SETTINGS.upiId).slice(
      0,
      80,
    ),
    upiApps,
    thermalColorMode,
  };
}

export function readPrintSettings(): PrintSettings {
  if (typeof window === "undefined") return DEFAULT_PRINT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PRINT_SETTINGS;

    const saved = JSON.parse(raw) as unknown;
    const normalized = normalizePrintSettings(saved);
    const migrationDone =
      window.localStorage.getItem(PREMIUM_DEFAULT_MIGRATION_KEY) === "1";
    if (!migrationDone) {
      // The premium renderer was already available in older builds, but the
      // persisted default was classic. Upgrade that legacy default once so an
      // existing install gets the new branded bills without removing the
      // classic option from Settings.
      const migrated =
        isRecord(saved) && saved["templateStyle"] === "classic"
          ? { ...normalized, templateStyle: "premium" as const }
          : normalized;
      window.localStorage.setItem(KEY, JSON.stringify(migrated));
      window.localStorage.setItem(PREMIUM_DEFAULT_MIGRATION_KEY, "1");
      return migrated;
    }
    return normalized;
  } catch {
    return DEFAULT_PRINT_SETTINGS;
  }
}

export function writePrintSettings(value: PrintSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(value));
  // A manual save is an explicit choice, including choosing classic. Mark
  // the one-time default migration complete so that choice is preserved.
  window.localStorage.setItem(PREMIUM_DEFAULT_MIGRATION_KEY, "1");
  window.dispatchEvent(new CustomEvent("ks:print-settings"));
}

/** Resolves the actual roll/sheet width in mm for the current settings,
 * honouring the custom-width field when "custom" is selected. */
export function paperWidthMm(
  s: Pick<PrintSettings, "paper" | "customWidthMm">,
) {
  const info = paperInfo(s.paper);
  // Floor of 50mm — the narrowest paper the item table's #/label/qty/amount
  // column layout can actually lay out without the columns' anchor points
  // colliding (worst case: "Extra large" text on an auto-margin roll). That
  // matches the narrowest built-in preset (Thermal 2" / 50mm) already
  // offered, so custom rolls never go narrower than real hardware this app
  // ships a preset for.
  if (s.paper === "custom")
    return Math.max(50, Math.min(300, s.customWidthMm || 72));
  return info.widthMm;
}

/** Reactive access to the saved printer preferences. */
export function usePrintSettings() {
  const [settings, setSettings] = useState<PrintSettings>(
    DEFAULT_PRINT_SETTINGS,
  );

  useEffect(() => {
    setSettings(readPrintSettings());
    const sync = () => setSettings(readPrintSettings());
    window.addEventListener("ks:print-settings", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("ks:print-settings", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const save = (next: PrintSettings) => {
    setSettings(next);
    writePrintSettings(next);
  };

  return { settings, save };
}
