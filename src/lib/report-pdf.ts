import { jsPDF } from "jspdf";
import {
  isAndroid,
  isDesktop,
  openExternal,
  revealInFolder,
  saveExportFile,
  saveToInvoicesFolder,
  INVOICE_SECTIONS,
  type InvoiceSection,
} from "./desktop";
import { rupees } from "./money";
import { readPrintSettings, type PrintSettings } from "./print";

/** Shrinks `text` (with the CURRENT font/size already applied) down to fit
 * `maxW` mm by dropping trailing characters and adding "…", instead of
 * letting it run into a neighbouring column — same approach receipt.ts uses
 * for its item table. Must be called only after pdf.setFont/setFontSize for
 * this text, since getTextWidth measures against whatever font is active. */
const fitToWidth = (pdf: jsPDF, text: string, maxW: number) => {
  const safeMaxW = Math.max(4, maxW);
  if (pdf.getTextWidth(text) <= safeMaxW) return text;
  let t = text;
  while (t.length > 1 && pdf.getTextWidth(`${t}…`) > safeMaxW)
    t = t.slice(0, -1);
  return `${t}…`;
};

/** PDF-safe money: helvetica has no ₹ glyph (same reasoning as receipt.ts's
 * own `pmoney`), so amounts print as "Rs 12,345" instead. */
const pmoney = (n: number, symbol: string) => {
  const v = rupees(n);
  const sym = (symbol || "Rs").trim();
  const prefix = sym ? `${sym} ` : "";
  return (v < 0 ? "-" : "") + prefix + Math.abs(v).toLocaleString("en-IN");
};

export type ReportTableRow = {
  cells: string[];
  strong?: boolean;
  negative?: boolean;
};
export type ReportTable = {
  title: string;
  columns: string[];
  align?: ("left" | "right")[];
  rows: ReportTableRow[];
};

export type ReportPdfDoc = {
  title: string;
  subtitle: string;
  tables: ReportTable[];
  fileName: string;
};

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 16;

/** Builds a plain A4 branded monthly-statement PDF: shop header, then a
 * stack of simple tables, paginating automatically when a section runs off
 * the bottom of the page. Deliberately simpler than the itemised receipt
 * builder in receipt.ts — this is a summary document, not an item-by-item
 * bill, so it doesn't need that file's paper-size/thermal-printer logic. */
export function buildReportPdf(
  doc: ReportPdfDoc,
  s: PrintSettings = readPrintSettings(),
): jsPDF {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const contentW = PAGE_W - MARGIN * 2;
  let y = MARGIN;

  const ensureSpace = (need: number) => {
    if (y + need > PAGE_H - MARGIN) {
      pdf.addPage();
      y = MARGIN;
    }
  };

  // Header: shop name + address/phone, matching what's already configured
  // for receipts in Settings so the statement looks like it came from the
  // same business.
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.setTextColor(20);
  pdf.text(s.shopName || "Business", MARGIN, y);
  y += 6;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(90);
  if (s.shopAddress.trim()) {
    const addrLines = pdf.splitTextToSize(s.shopAddress.trim(), contentW);
    pdf.text(addrLines, MARGIN, y);
    y += addrLines.length * 4.2;
  }
  if (s.showPhone && s.shopPhone.trim()) {
    pdf.text(s.shopPhone.trim(), MARGIN, y);
    y += 4.2;
  }

  y += 4;
  pdf.setDrawColor(210);
  pdf.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 8;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(20);
  pdf.text(doc.title, MARGIN, y);
  y += 6;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9.5);
  pdf.setTextColor(110);
  pdf.text(doc.subtitle, MARGIN, y);
  y += 9;

  for (const table of doc.tables) {
    ensureSpace(14);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10.5);
    pdf.setTextColor(30);
    pdf.text(table.title, MARGIN, y);
    y += 5;

    const colCount = table.columns.length;
    const align: ("left" | "right")[] =
      table.align ?? table.columns.map((_, i) => (i === 0 ? "left" : "right"));
    const firstColW = contentW * 0.4;
    const restColW = (contentW - firstColW) / Math.max(1, colCount - 1);
    const colX = table.columns.map((_, i) =>
      i === 0 ? MARGIN : MARGIN + firstColW + restColW * (i - 1),
    );
    const colW = table.columns.map((_, i) => (i === 0 ? firstColW : restColW));

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(120);
    table.columns.forEach((c, i) => {
      const a = align[i]!;
      const x = a === "right" ? colX[i]! + colW[i]! : colX[i]!;
      // Clamp to this column's own width (minus a small gap) so a long
      // header — or, below, a long cell value — can't run into the next
      // column instead of stopping at its own boundary.
      pdf.text(fitToWidth(pdf, c, colW[i]! - 2), x, y, { align: a });
    });
    y += 2;
    pdf.setDrawColor(225);
    pdf.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 4.5;

    for (const row of table.rows) {
      ensureSpace(6);
      pdf.setFont("helvetica", row.strong ? "bold" : "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(
        row.negative ? 180 : 40,
        row.negative ? 40 : 40,
        row.negative ? 40 : 40,
      );
      row.cells.forEach((cell, i) => {
        const a = align[i]!;
        const x = a === "right" ? colX[i]! + colW[i]! : colX[i]!;
        pdf.text(fitToWidth(pdf, cell, colW[i]! - 2), x, y, { align: a });
      });
      y += 5.2;
    }
    y += 5;
  }

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(150);
  pdf.text(
    `Generated ${new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}`,
    MARGIN,
    PAGE_H - 10,
  );

  return pdf;
}

/** Saves the report PDF — desktop writes straight into the shared
 * `Invoices/` folder (no Save dialog), same as `downloadReceipt` in
 * receipt.ts; browser/PWA keeps jsPDF's own Blob download. Android is
 * matched before the generic desktop branch and routed through
 * `saveExportFile` instead — see `downloadReceipt` in receipt.ts for why.
 * Returns `false` only when the Android save genuinely failed, so callers
 * (ArchiveCard's verification PDF, ReportsTab's exportPdf) can skip a
 * false-positive "saved" toast. */
export async function downloadReportPdf(
  doc: ReportPdfDoc,
  s: PrintSettings = readPrintSettings(),
  section: InvoiceSection | (string & {}) = INVOICE_SECTIONS.reports,
): Promise<boolean> {
  const pdf = buildReportPdf(doc, s);
  if (isAndroid()) {
    const bytes = pdf.output("arraybuffer") as ArrayBuffer;
    const result = await saveExportFile(
      new Uint8Array(bytes),
      `${doc.fileName}.pdf`,
      "application/pdf",
    );
    return result.saved;
  }
  if (isDesktop()) {
    const bytes = pdf.output("arraybuffer") as ArrayBuffer;
    const abs = await saveToInvoicesFolder(
      new Uint8Array(bytes),
      `${doc.fileName}.pdf`,
      section,
    );
    await revealInFolder(abs);
    return true;
  }
  pdf.save(`${doc.fileName}.pdf`);
  return true;
}

/** Shares the report PDF via WhatsApp where possible, falling back to a
 * plain download — mirrors `shareReceipt`'s desktop/mobile/browser split.
 * Android is excluded from the desktop-only early-return branch (it also
 * satisfies `isDesktop()`, but its WebView supports the Web Share API with
 * file attachments, so it should get a real "shared"/"cancelled" attempt
 * instead of always reporting "fallback" the way it used to). */
export async function shareReportPdf(
  doc: ReportPdfDoc,
  fallbackUrl: string,
  s: PrintSettings = readPrintSettings(),
  section: InvoiceSection | (string & {}) = INVOICE_SECTIONS.reports,
): Promise<"shared" | "fallback" | "cancelled"> {
  const pdf = buildReportPdf(doc, s);
  if (isDesktop() && !isAndroid()) {
    await downloadReportPdf(doc, s, section);
    await openExternal(fallbackUrl);
    return "fallback";
  }
  const blob = pdf.output("blob");
  const file = new File([blob], `${doc.fileName}.pdf`, {
    type: "application/pdf",
  });
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: doc.title });
      return "shared";
    } catch {
      return "cancelled";
    }
  }
  if (isAndroid()) {
    const saved = await downloadReportPdf(doc, s, section);
    if (!saved) return "cancelled";
    await openExternal(fallbackUrl);
    return "fallback";
  }
  await downloadReportPdf(doc, s, section);
  await openExternal(fallbackUrl);
  return "fallback";
}

export { pmoney as reportPdfMoney };
