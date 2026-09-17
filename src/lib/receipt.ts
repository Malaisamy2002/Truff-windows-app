import { jsPDF } from "jspdf";
import { toast } from "sonner";
import {
  BUSINESS_NAME,
  billGrossTotal,
  bookingGrossTotal,
  bookingTaxable,
  snackSaleGrossTotal,
  taxLinesWithFallback,
  billPaidAmount,
  billTaxLines,
  formatDMY,
  money,
  UNIT_SHORT,
  type Bill,
} from "./biz";
import {
  isAndroid,
  isDesktop,
  openExternal,
  revealInFolder,
  saveExportFile,
  saveToInvoicesFolder,
  type InvoiceSection,
} from "./desktop";
import { rupees } from "./money";
import type { SnackSale, TurfBooking } from "./ops";
import {
  paperInfo,
  paperWidthMm,
  readPrintSettings,
  type PrintSettings,
} from "./print";
import { printPdfBytesAsImages } from "./print-raster";
import { buildPremiumReceiptPdf } from "./receipt-premium";
import { readAppSettings } from "./settings";

/** PDF-safe money: helvetica has no rupee glyph, and receipts drop paise.
 *  Handles negative amounts (used for the "Advance paid" / "Offer" line
 *  items, which are shown as deductions) as "-Rs 500" rather than the
 *  confusing "Rs -500". */
const pmoney = (n: number, symbol = readPrintSettings().currencySymbol) => {
  const v = rupees(n);
  const sym = (symbol || "Rs").trim();
  const prefix = sym ? `${sym} ` : "";
  return (v < 0 ? "-" : "") + prefix + Math.abs(v).toLocaleString("en-IN");
};

/** jsPDF's addImage wants an explicit format string matching the data URL's
 * actual encoding — branding images may be PNG (small crisp logos/headers)
 * or JPEG (large photo-like backgrounds, kept small via lossy compression). */
const imgFormat = (dataUrl: string): "PNG" | "JPEG" =>
  dataUrl.startsWith("data:image/jpeg") ? "JPEG" : "PNG";

/** `qty` is shown in its own column on the item table when present; `sub`
 * (e.g. a rate breakdown like "1 hr x Rs 1200") still prints as a smaller
 * line under the item label either way. */
export type ReceiptLine = {
  label: string;
  sub?: string;
  amount?: number;
  qty?: number | string;
};
export type ReceiptTotal = { label: string; value: string; strong?: boolean };

export type ReceiptDoc = {
  kind: string;
  docNo: string;
  dateText: string;
  customer?: string | null;
  phone?: string | null;
  /** Customer email, shown in the Bill To block when the record has one. */
  email?: string | null;
  lines: ReceiptLine[];
  totals: ReceiptTotal[];
  note?: string | null;
  fileName: string;
};

/** Line-height multipliers for the "compact / normal / relaxed" line-spacing
 * setting, applied on top of the paper's base line height. */
const LINE_SPACING_SCALE: Record<PrintSettings["lineSpacing"], number> = {
  compact: 0.85,
  normal: 1,
  relaxed: 1.2,
};

/** Text darkness for the "light / normal / dark" density setting. Lower is
 * darker (0 = pure black); mirrors a thermal printer's darkness dial. */
const DENSITY_SHADE: Record<PrintSettings["density"], number> = {
  light: 90,
  normal: 30,
  dark: 0,
};

/** Builds a receipt PDF sized for the printer selected in Settings.
 *
 * When Settings has the "premium" template style on, this first tries the
 * boxed/two-tone letterhead layout in receipt-premium.ts — it only covers
 * A4/A5/80mm/58mm/50mm paper, so any other paper (Letter, 76mm, a custom
 * roll width) silently falls through to the classic renderer below, same as
 * if "classic" had been selected. */
export function buildReceiptPdf(
  doc: ReceiptDoc,
  s: PrintSettings = readPrintSettings(),
): jsPDF {
  if (s.templateStyle === "premium") {
    const premium = buildPremiumReceiptPdf(doc, s);
    if (premium) return premium;
  }
  const paper = paperInfo(s.paper);
  const width = paperWidthMm(s);
  const wide = paper.kind === "sheet";
  const scale = s.fontScale || 1;
  const spacing = LINE_SPACING_SCALE[s.lineSpacing] || 1;
  const shade = DENSITY_SHADE[s.density] ?? 30;
  const lineH = (wide ? 6 : 5) * scale * spacing;

  // Full-bleed A4 background takes priority on A4 sheets — it carries the
  // header AND footer artwork, so nothing else (banner/logo/text header) is
  // drawn on top of it. Roll header artwork plays the same role for thermal
  // rolls, replacing the small square logo + text header. Plain banner stays
  // available for A5/letter sheets that don't have a matching full-page asset.
  const showBranding = s.showLogo;
  const showFullBackground =
    showBranding && wide && paper.id === "a4" && !!s.background;
  const showRollHeader = showBranding && !wide && !!s.rollHeader;
  const showBanner = showBranding && wide && !!s.banner && !showFullBackground;
  const showLogo =
    showBranding &&
    !!s.logo &&
    !showBanner &&
    !showFullBackground &&
    !showRollHeader;
  const extraBrandH = !wide && showLogo ? 18 : 0;

  // 0 = automatic: 12 mm on sheets, 5 mm on rolls. Clamped so a large custom
  // margin can never eat the whole printable width. The designed A4 letterhead
  // reads better with a slightly wider gutter than the plain-text header.
  const marginX =
    s.marginMm > 0
      ? Math.min(s.marginMm, width / 3)
      : wide
        ? showFullBackground
          ? 20
          : 12
        : 5;

  // The roll-header artwork is scaled to the printable width, same inset as
  // everything else on the receipt, so its drawn height depends on the
  // paper's own width and has to be known before the page height is fixed.
  const rollHeaderMaxW = width - marginX * 2;
  const rollHeaderNaturalH =
    showRollHeader && s.rollHeader
      ? rollHeaderMaxW * (s.rollHeader.height / s.rollHeader.width)
      : 0;
  const MAX_ROLL_HEADER_HEIGHT_MM = 45;
  const rollHeaderH = Math.min(rollHeaderNaturalH, MAX_ROLL_HEADER_HEIGHT_MM);
  const rollHeaderDrawW =
    showRollHeader &&
    s.rollHeader &&
    rollHeaderNaturalH > MAX_ROLL_HEADER_HEIGHT_MM
      ? rollHeaderH * (s.rollHeader.width / s.rollHeader.height)
      : rollHeaderMaxW;
  // Extra blank feed at the very bottom so a thermal auto-cutter doesn't
  // slice through the last printed line. Sheets ignore this — they're cut
  // to size already.
  const cutFeedMm = wide ? 0 : Math.max(0, Math.min(40, s.cutFeedMm || 0));

  // Previously this estimated the page height up front (address line-wrap
  // guesses, a flat per-item line count, etc.) and built the PDF straight to
  // that guess. Any mismatch between the guess and what actually gets drawn
  // shows up as a permanent blank gap at the bottom of the roll — worse the
  // longer the bill, since guesses compound (a slightly-off address-wrap
  // estimate, GSTIN/FSSAI lines not being budgeted, the 0.6mm-per-row
  // rounding in every left()/row()/field()/itemRow() call, etc.). Sheet
  // paper doesn't have this problem (A4/A5/Letter are already a fixed
  // physical size), but roll paper's whole point is a page exactly as long
  // as the receipt — so instead of estimating, `renderBody` below is run
  // once on a generously tall scratch page purely to measure the real final
  // `y`, then run again on a page built to that exact measured height. Two
  // passes of the same deterministic drawing code, not two different
  // formulas, so there is nothing left to under- or over-shoot.
  const renderBody = (pdf: jsPDF, pageHeightMm: number): number => {
    let y = wide ? 16 : 10;

    // Body font sizes (doc-info block, item rows, totals) scale with the paper
    // kind the same way the header text does, so a sheet printout doesn't end
    // up with a big title sitting over cramped, thermal-sized body copy. Ratio
    // matches the header/footer scale-up (roughly 1.25x sheet vs roll).
    const bodyFont = wide ? 10 : 8;
    const noteFont = wide ? 8 : 7;

    const center = (text: string, size: number, bold = false) => {
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      pdf.setFontSize(size * scale);
      pdf.text(text, width / 2, y, { align: "center" });
      y += lineH;
    };
    // Centered title that wraps to multiple lines (and shrinks a little if it
    // still doesn't fit on one) instead of running off the page edges — used
    // for the shop name, which varies a lot in length.
    const centerFit = (text: string, size: number, bold = true) => {
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      const maxW = width - marginX * 2;
      let fitSize = size;
      pdf.setFontSize(fitSize * scale);
      while (fitSize > size * 0.7 && pdf.getTextWidth(text) > maxW) {
        fitSize -= 0.5;
        pdf.setFontSize(fitSize * scale);
      }
      const lines = pdf.splitTextToSize(text, maxW) as string[];
      for (const line of lines) center(line, fitSize, bold);
    };
    // Shrinks `text` (with the CURRENT font/size already applied) down to fit
    // `maxW` mm by dropping trailing characters and adding "…", instead of
    // letting it run past the printable edge or into a neighbouring column.
    // Must be called only after pdf.setFont/setFontSize for this text, since
    // getTextWidth measures against whatever font is currently active.
    const fitToWidth = (text: string, maxW: number) => {
      const safeMaxW = Math.max(4, maxW);
      if (pdf.getTextWidth(text) <= safeMaxW) return text;
      let t = text;
      while (t.length > 1 && pdf.getTextWidth(`${t}…`) > safeMaxW)
        t = t.slice(0, -1);
      return `${t}…`;
    };
    const left = (text: string, size = bodyFont, bold = false) => {
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      pdf.setFontSize(size * scale);
      // Every `left()` caller (the item sub-line, the note) prints across the
      // full printable width with nothing after it, so clip instead of letting
      // a long line run off the sheet/roll edge.
      pdf.text(fitToWidth(text, width - marginX * 2), marginX, y);
      y += lineH - 0.6;
    };
    const row = (l: string, r: string, bold = false) => {
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      pdf.setFontSize(bodyFont * scale);
      // A long label (e.g. a custom tax name) could otherwise run straight
      // into the right-aligned value — clamp it to whatever room is actually
      // left once the value's own width is measured, same guard itemRow()
      // already applies to item labels vs. the qty/amount columns.
      const rW = pdf.getTextWidth(r);
      const maxLabelW = Math.max(6, width - marginX * 2 - rW - 1.5);
      pdf.text(fitToWidth(l, maxLabelW), marginX, y);
      pdf.text(r, width - marginX, y, { align: "right" });
      y += lineH - 0.6;
    };
    const rule = () => {
      pdf.setDrawColor(120);
      pdf.line(marginX, y - 3, width - marginX, y - 3);
      y += 1.5;
    };
    // Dashed divider — used around the shop header block, matching the
    // "- - - -" break in the reference receipt template.
    const dashedRule = () => {
      pdf.setDrawColor(120);
      pdf.setLineDashPattern([wide ? 1.5 : 1, wide ? 1.2 : 0.8], 0);
      pdf.line(marginX, y - 3, width - marginX, y - 3);
      pdf.setLineDashPattern([], 0);
      y += 1.5;
    };
    // "Label : value" row with the value column starting at a fixed x, so the
    // colons line up top-to-bottom regardless of label length (helvetica isn't
    // monospaced, so padding label strings with spaces wouldn't align).
    const labelColW = wide ? 24 : 17;
    const field = (
      label: string,
      value: string,
      size = bodyFont,
      bold = false,
    ) => {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(size * scale);
      pdf.text(label, marginX, y);
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      // Long values (a long customer name/email, or a due number like
      // "D-050926-INV-0007") previously had nothing stopping them running
      // past the paper's right edge, worst on narrow rolls — clip with an
      // ellipsis the same way every other value-drawing helper here does.
      const availW = Math.max(6, width - marginX - (marginX + labelColW));
      pdf.text(fitToWidth(`: ${value}`, availW), marginX + labelColW, y);
      y += lineH - 0.6;
    };
    // Item table columns: "#" | item (+ optional smaller sub-line) | qty | amount.
    // Measure the real quantity and amount strings before setting the columns.
    // A fixed offset works only until a larger text setting, a long quantity
    // ("12 courts"), or a large total is selected; after that it makes the
    // numeric columns overlap on thermal rolls. Every paper type now reserves
    // exactly what its own widest row needs.
    const noColW = (wide ? 9 : 7) * scale;
    const tableGap = Math.max(1.5, scale * (wide ? 1.8 : 1.2));
    const contentW = width - marginX * 2;
    const moneyText = (value: number) => pmoney(value, s.currencySymbol);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(bodyFont * scale);
    const itemQtys = [
      "QTY",
      ...doc.lines.map((line) =>
        line.qty === undefined ? "" : String(line.qty),
      ),
    ];
    const amountHeader = wide ? "AMOUNT" : "AMT";
    const itemAmounts = [
      amountHeader,
      ...doc.lines.map((line) => moneyText(line.amount ?? 0)),
    ];
    const widest = (values: string[]) =>
      Math.max(...values.map((value) => pdf.getTextWidth(value)));
    const qtyColW = Math.min(
      contentW * (wide ? 0.24 : 0.35),
      Math.max(7 * scale, widest(itemQtys)),
    );
    // Reserve the real width needed by the amount text. A proportional cap
    // looks fine on A4 but clips digits on 50/58 mm rolls when the shop uses
    // a longer currency prefix or a larger text scale. The compact thermal
    // layout below can still fall back to a second line when the paper truly
    // has no room for all four columns.
    const amountColW = Math.min(
      Math.max(contentW - noColW - 6, 12 * scale),
      Math.max(12 * scale, widest(itemAmounts)),
    );
    const numericW = qtyColW + amountColW + tableGap;
    const normalLabelW = contentW - noColW - numericW - tableGap;
    // On a 50 mm roll with extra-large text, the four-column arrangement has
    // no readable label column. Keep the same information but place qty and
    // amount on a second, aligned line instead of allowing any overlap.
    const compactThermalTable = !wide && normalLabelW < 10 * scale;
    const itemRow = (
      no: string,
      label: string,
      qty: string,
      amount: string,
      bold = false,
    ) => {
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      pdf.setFontSize(bodyFont * scale);
      const amountText = fitToWidth(amount, amountColW);
      const qtyText = fitToWidth(qty, qtyColW);
      const qtyX = width - marginX - amountColW - tableGap;
      const labelMaxW = compactThermalTable
        ? Math.max(10, contentW - noColW - tableGap)
        : Math.max(6, normalLabelW);
      // Wrap the label onto up to 2 lines instead of clipping mid-text —
      // clipping used to cut booking time ranges ("06:00-07:…") in half on
      // narrow 80 mm rolls. Only a label that still overflows 2 full lines
      // falls back to the ellipsis.
      const wrapped = pdf.splitTextToSize(label, labelMaxW) as string[];
      const labelLines =
        wrapped.length <= 2
          ? wrapped
          : [
              wrapped[0] ?? "",
              fitToWidth(wrapped.slice(1).join(" "), labelMaxW),
            ];
      pdf.text(no, marginX, y);
      pdf.text(labelLines[0] ?? "", marginX + noColW, y);
      if (!compactThermalTable) {
        pdf.text(qtyText, qtyX, y, { align: "right" });
        pdf.text(amountText, width - marginX, y, { align: "right" });
      }
      y += lineH - 0.6;
      for (let li = 1; li < labelLines.length; li++) {
        pdf.text(labelLines[li] ?? "", marginX + noColW, y);
        y += lineH - 0.6;
      }
      if (compactThermalTable) {
        const compactQtyW = Math.max(
          6,
          contentW - pdf.getTextWidth(amountText) - tableGap,
        );
        pdf.text(fitToWidth(qtyText, compactQtyW), marginX, y);
        pdf.text(amountText, width - marginX, y, { align: "right" });
        y += lineH - 0.6;
      }
    };

    // Sheet-only (A5/A4/Letter) bordered item table — thermal rolls keep the
    // plain itemRow() above unchanged (bordered fills don't suit POS paper or
    // ink, and matches how real receipts look). Sheets get the header-shaded,
    // row-ruled table that invoice generators (Zoho/QuickBooks/FreshBooks/
    // Wave-style) use: right-aligned numeric columns, a tinted header row, and
    // a light zebra tint on alternating rows so long item lists stay scannable.
    // Reuses the same column geometry (noColW/qtyColW) as itemRow so the
    // header and totals block below stay aligned with the columns above them.
    const TABLE_HEADER_FILL: [number, number, number] = [223, 240, 231];
    const TABLE_HEADER_TEXT: [number, number, number] = [21, 105, 60];
    const TABLE_ZEBRA_FILL: [number, number, number] = [246, 248, 247];
    const TABLE_RULE = 205;
    const sheetItemTable = (lines: ReceiptLine[]) => {
      const qtyX = width - marginX - amountColW - tableGap;
      const labelX = marginX + noColW;
      const labelColW = Math.max(10, qtyX - qtyColW - tableGap - labelX);
      const rowLineH = lineH - 0.6;
      // Every band (the header, then each item row) is laid out the same
      // way: `topPad` mm from the band's top edge up to its first text
      // baseline, `bottomPad` mm from its last baseline down to its bottom
      // edge. Each band's bottom edge is used, unmodified, as the next
      // band's top edge (`nextBaseline` below) — so the shaded header, the
      // alternating row tints and the divider rules always stack with zero
      // gap and zero overlap, instead of being computed independently and
      // risking one band's fill painting over the previous band's rule.
      //
      // jsPDF's setFontSize is always in POINTS regardless of the document's
      // "mm" unit, so topPad/bottomPad must be derived from the real font
      // size instead of being flat constants — otherwise they silently stop
      // matching the text the moment the font size or the font-scale setting
      // changes. Helvetica's cap height is ~0.72em and its descender depth is
      // ~0.21em; converting bodyFont*scale from pt to mm (×0.3528) and adding
      // a small buffer keeps the shaded band tall enough to fully contain the
      // text at any paper/font-scale combination, instead of letting the tops
      // of capital letters (ITEM/QTY/AMOUNT, tall item names) poke out past
      // the band's edge into the rule or row above it.
      const fontMm = bodyFont * scale * 0.3528;
      const topPad = fontMm * 0.8;
      const bottomPad = fontMm * 0.4;

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(bodyFont * scale);
      // Wrap each label to at most 2 lines against the real column width
      // (rather than the full-page fitToWidth clipping itemRow uses) so a long
      // item name reads in full instead of ending in "…" whenever two short
      // lines would do.
      const rows = lines.map((it) => ({
        it,
        labelLines: (
          pdf.splitTextToSize(it.label || "", labelColW) as string[]
        ).slice(0, 2),
      }));

      // Header band.
      const headerBaseline = y;
      const headerTop = headerBaseline - topPad;
      const headerBottom = headerBaseline + bottomPad;
      pdf.setFillColor(...TABLE_HEADER_FILL);
      pdf.rect(
        marginX,
        headerTop,
        width - marginX * 2,
        headerBottom - headerTop,
        "F",
      );
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(bodyFont * scale);
      pdf.setTextColor(...TABLE_HEADER_TEXT);
      pdf.text("#", marginX + 1, headerBaseline);
      pdf.text("ITEM", labelX, headerBaseline);
      pdf.text("QTY", qtyX, headerBaseline, { align: "right" });
      pdf.text("AMOUNT", width - marginX, headerBaseline, { align: "right" });
      pdf.setTextColor(shade);
      pdf.setDrawColor(TABLE_RULE);
      pdf.line(marginX, headerBottom, width - marginX, headerBottom);

      // Baseline the next band (first item row, then each row after) will
      // draw its first line of text on.
      let nextBaseline = headerBottom + topPad;

      rows.forEach(({ it, labelLines }, i) => {
        const lineCount = Math.max(1, labelLines.length);
        const firstBaseline = nextBaseline;
        const lastLabelBaseline = firstBaseline + (lineCount - 1) * rowLineH;
        // The optional smaller "sub" line (e.g. a rate breakdown) sits closer
        // to the line above it than a full row-height gap, matching how it's
        // drawn on thermal receipts today.
        const subBaseline = it.sub ? lastLabelBaseline + rowLineH * 0.85 : null;
        const lastBaseline = subBaseline ?? lastLabelBaseline;
        const bandTop = firstBaseline - topPad;
        const bandBottom = lastBaseline + bottomPad;

        if (i % 2 === 1) {
          pdf.setFillColor(...TABLE_ZEBRA_FILL);
          pdf.rect(
            marginX,
            bandTop,
            width - marginX * 2,
            bandBottom - bandTop,
            "F",
          );
        }

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(bodyFont * scale);
        pdf.setTextColor(shade);
        pdf.text(String(i + 1), marginX + 1, firstBaseline);
        labelLines.forEach((line, li) =>
          pdf.text(line, labelX, firstBaseline + li * rowLineH),
        );
        const qty = it.qty !== undefined ? String(it.qty) : "";
        pdf.text(fitToWidth(qty, qtyColW), qtyX, firstBaseline, {
          align: "right",
        });
        pdf.text(
          fitToWidth(moneyText(it.amount ?? 0), amountColW),
          width - marginX,
          firstBaseline,
          { align: "right" },
        );
        if (it.sub && subBaseline !== null) {
          pdf.setFontSize((wide ? 9 : 7) * scale);
          pdf.text(fitToWidth(`   ${it.sub}`, labelColW), labelX, subBaseline);
          pdf.setFontSize(bodyFont * scale);
        }

        pdf.setDrawColor(TABLE_RULE);
        pdf.line(marginX, bandBottom, width - marginX, bandBottom);
        nextBaseline = bandBottom + topPad;
      });

      // Hand off exactly like itemRow's loop does: `y` left at the next fresh
      // baseline, so the caller's own `y += 1; rule();` right after this call
      // lands in the gap below the table's own closing rule instead of
      // through the last row's text.
      y = nextBaseline;
    };

    if (showFullBackground && s.background) {
      // Full-bleed: covers the entire page, corner to corner. The artwork
      // already carries the logo, business name, tagline, address, phone and
      // footer band, so everything below skips straight to the blank zone the
      // letterhead was designed to leave for the bill's own content.
      pdf.addImage(
        s.background.dataUrl,
        imgFormat(s.background.dataUrl),
        0,
        0,
        width,
        pageHeightMm,
      );
      y = s.a4ContentTopMm;
    } else if (showBanner && s.banner) {
      const maxW = width - marginX * 2;
      const maxH = 28;
      let drawW = maxW;
      let drawH = drawW * (s.banner.height / s.banner.width);
      if (drawH > maxH) {
        drawH = maxH;
        drawW = drawH * (s.banner.width / s.banner.height);
      }
      pdf.addImage(
        s.banner.dataUrl,
        imgFormat(s.banner.dataUrl),
        (width - drawW) / 2,
        y,
        drawW,
        drawH,
      );
      y += drawH + 3;
    } else if (showLogo && s.logo) {
      const drawH = wide ? 20 : 14;
      const drawW = drawH * (s.logo.width / s.logo.height);
      pdf.addImage(
        s.logo.dataUrl,
        imgFormat(s.logo.dataUrl),
        (width - drawW) / 2,
        y,
        drawW,
        drawH,
      );
      // Logo artwork (crest + wings) commonly has little internal bottom
      // padding, so give the title below it real breathing room rather than
      // the couple of mm used elsewhere.
      y += drawH + (wide ? 6 : 4);
    } else if (showRollHeader && s.rollHeader) {
      // Same left/right inset as the rest of the receipt, not full-bleed —
      // the artwork already has its own internal padding, so this keeps it
      // flush with the item table and totals below it.
      const drawY = 3;
      pdf.addImage(
        s.rollHeader.dataUrl,
        imgFormat(s.rollHeader.dataUrl),
        (width - rollHeaderDrawW) / 2,
        drawY,
        rollHeaderDrawW,
        rollHeaderH,
      );
      y = drawY + rollHeaderH + 2;
    }

    // The banner/full-page background/roll-header artwork already carries the
    // business name, tagline, address and phone visually — skip the redundant
    // text so the header doesn't repeat itself. GSTIN/FSSAI are dynamic (set
    // in App Settings, not baked into any artwork) so they always still print
    // when set.
    pdf.setTextColor(21, 105, 60);
    if (!showBanner && !showFullBackground && !showRollHeader)
      centerFit(
        (s.shopName || BUSINESS_NAME).toUpperCase(),
        wide ? 16 : 12,
        true,
      );
    pdf.setTextColor(shade);
    if (!showFullBackground && !showRollHeader) {
      if (s.headerLine) center(s.headerLine, wide ? 9 : 7);
      if (s.shopAddress.trim()) {
        // Wrap the address to the printable width so long addresses don't run
        // off the edge of a narrow thermal roll.
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize((wide ? 9 : 7) * scale);
        for (const line of pdf.splitTextToSize(
          s.shopAddress.trim(),
          width - marginX * 2,
        ) as string[]) {
          center(line, wide ? 9 : 7);
        }
      }
      if (s.shopPhone.trim()) center(`Ph: ${s.shopPhone.trim()}`, wide ? 9 : 7);
      if (s.shopEmail.trim()) center(s.shopEmail.trim(), wide ? 9 : 7);
    }
    const app = readAppSettings();
    // Each registration line prints only when its own toggle is on, independent
    // of the GST-on-bills toggle — a business can hold either registration
    // without charging GST on a particular sale.
    if (app.gstinEnabled && app.gstin)
      center(`GSTIN: ${app.gstin}`, wide ? 8 : 6);
    if (app.fssaiEnabled && app.fssaiNumber)
      center(`FSSAI: ${app.fssaiNumber}`, wide ? 8 : 6);
    y += 1;
    // The roll-header/full-background artwork already bakes in a dashed rule
    // and the "BILL"-style title, so only draw them here for the plain-text
    // header and banner cases, which don't carry a title of their own.
    if (!showFullBackground && !showRollHeader) {
      dashedRule();
      y += 1;
      center(doc.kind.toUpperCase(), wide ? 14 : 11, true);
      rule();
    } else {
      rule();
    }
    y += 0.5;
    if (doc.customer) field("Bill To", doc.customer);
    if (doc.phone && s.showPhone) field("Phone", doc.phone);
    if (doc.email) field("Email", doc.email);
    field("Date", doc.dateText);
    field(`${doc.kind} No.`, doc.docNo);
    y += 1;
    rule();
    if (wide) {
      // A5/A4/Letter: bordered, header-shaded table (see sheetItemTable above).
      y += 1;
      sheetItemTable(doc.lines);
    } else {
      // Thermal rolls: plain ruled columns, unchanged from before.
      itemRow("#", "ITEM", "QTY", amountHeader, true);
      y += 1;
      doc.lines.forEach((it, i) => {
        itemRow(
          String(i + 1),
          it.label,
          it.qty !== undefined ? String(it.qty) : "",
          moneyText(it.amount ?? 0),
        );
        if (it.sub) left(`   ${it.sub}`, wide ? 9 : 7, false);
      });
    }
    y += 1;
    rule();
    for (const t of doc.totals) row(t.label, t.value, t.strong);
    if (doc.note) {
      y += 1;
      left(`Note: ${doc.note}`, noteFont);
    }
    y += 2;
    // The full-page background's own footer band (address/phone/location,
    // baked into the artwork ~271mm down the A4 page) would collide with a
    // second footer line drawn in the default text color, so it's skipped
    // there; the roll-header case has plain paper below it and is unaffected.
    if (!showFullBackground) {
      rule();
      if (s.footerLine) center(s.footerLine, wide ? 10 : 8);
    }
    if (cutFeedMm) y += cutFeedMm;
    return y;
  };

  if (wide) {
    // Sheets (A5/A4/Letter) are already a fixed physical page size.
    const height = paper.heightMm!;
    const pdf = new jsPDF({ unit: "mm", format: [width, height] });
    renderBody(pdf, height);
    return pdf;
  }

  // Roll paper: draw once on a generously tall scratch page purely to
  // measure the real final y, then draw again on a page built to exactly
  // that height. See the comment above renderBody for why this replaced an
  // upfront size estimate.
  const SCRATCH_HEIGHT_MM = 3000; // comfortably taller than any realistic bill
  const scratchPdf = new jsPDF({
    unit: "mm",
    format: [width, SCRATCH_HEIGHT_MM],
  });
  const measuredY = renderBody(scratchPdf, SCRATCH_HEIGHT_MM);
  // Small trailing buffer so the last rule/text's descenders aren't flush
  // with the physical paper edge — independent of, and on top of, whatever
  // cutFeedMm the user configured for their auto-cutter (already folded
  // into measuredY above).
  const BOTTOM_SAFETY_MM = 2;
  const height = measuredY + BOTTOM_SAFETY_MM;
  const pdf = new jsPDF({ unit: "mm", format: [width, height] });
  renderBody(pdf, height);
  return pdf;
}

/**
 * Saves the receipt PDF. In the browser/PWA this is jsPDF's own Blob-download
 * `save()`. In the desktop shell it writes straight into the app's shared
 * `Invoices/` folder (see `saveToInvoicesFolder` in desktop.ts) and reveals
 * the file in Explorer — no Save dialog, so every bill PDF lands in one
 * predictable place instead of scattered across whatever folder the user
 * last browsed to. Kept async so both branches share one call site;
 * existing unawaited callers (`downloadBillPdf`, print/share fallbacks below)
 * keep working unchanged.
 *
 * Returns `false` when the save genuinely failed (currently only reachable
 * on Android, via `saveExportFile`) so callers can skip a false-positive
 * "saved"/"shared" message instead of always assuming success.
 */
export async function downloadReceipt(
  doc: ReceiptDoc,
  s: PrintSettings = readPrintSettings(),
  section?: InvoiceSection,
): Promise<boolean> {
  const pdf = buildReceiptPdf(doc, s);

  // Checked before the generic isDesktop() branch: Android satisfies
  // isDesktop() too, but the $DOCUMENT fs-scope write below isn't reliably
  // visible to the user there (see saveExportFile's doc comment).
  if (isAndroid()) {
    const bytes = pdf.output("arraybuffer") as ArrayBuffer;
    const result = await saveExportFile(
      new Uint8Array(bytes),
      `${doc.fileName}.pdf`,
      "application/pdf",
    );
    if (result.saved) {
      toast.success("PDF saved to Downloads", {
        description: `${doc.fileName}.pdf`,
      });
    } else {
      toast.error("Couldn't save PDF", {
        description: result.error ?? `${doc.fileName}.pdf`,
      });
    }
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
    toast.success("PDF saved", { description: `${doc.fileName}.pdf` });
    return true;
  }
  pdf.save(`${doc.fileName}.pdf`);
  toast.success("PDF downloaded", { description: `${doc.fileName}.pdf` });
  return true;
}

/** Prints one loaded PDF frame and removes it before the next copy starts. */
function printPdfFrame(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    let finished = false;
    const finish = (printed: boolean) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(loadTimeout);
      frame.remove();
      resolve(printed);
    };
    const loadTimeout = window.setTimeout(() => finish(false), 20_000);
    // A zero-size frame never gets a viewport, so the browser's built-in PDF
    // viewer (Chromium/WebView2) never actually renders into it — print()
    // then silently no-ops on an empty document instead of throwing, so a
    // fixed but genuinely sized frame is required here. It also has to stay
    // inside the viewport (left/top 0, hidden only via opacity/pointer-
    // events) rather than parked off-canvas — WebView2 silently refuses to
    // print an off-canvas frame too.
    frame.style.cssText =
      "position:fixed;left:0;top:0;width:800px;height:1000px;border:0;opacity:0;pointer-events:none;z-index:-1";
    frame.onload = () => {
      try {
        const printWindow = frame.contentWindow;
        if (!printWindow) throw new Error("Print frame is unavailable");
        let afterPrintFired = false;
        printWindow.addEventListener(
          "afterprint",
          () => {
            afterPrintFired = true;
            finish(true);
          },
          { once: true },
        );
        printWindow.focus();
        printWindow.print();
        // `print()` returning without throwing is NOT proof the native
        // dialog opened — WebView2's embedded PDF viewer can silently no-op
        // it. Some viewers genuinely omit `afterprint` after a real print,
        // so this can't wait forever, but treating a bare timeout as success
        // (the old behaviour) is exactly what made every Print button here
        // look like it did nothing: no dialog AND no error, because the
        // fallback below never got a chance to run. Report failure instead
        // so the caller falls back to opening the saved PDF.
        // 3s, not a hair-trigger: window.print() blocks the calling script
        // until the dialog closes on every Chromium-based engine we've
        // verified, so afterprint is normally already true well before this
        // fires. The margin exists only in case WebView2 ever shows the
        // dialog asynchronously instead of blocking — too short here would
        // misreport a still-open dialog as a failure and pop the saved-PDF
        // fallback open on top of it.
        window.setTimeout(() => {
          if (!afterPrintFired) finish(false);
        }, 3_000);
      } catch {
        finish(false);
      }
    };
    frame.src = url;
    document.body.appendChild(frame);
  });
}

/** Opens the print dialog with one serialized job per requested copy. */
export async function printReceipt(
  doc: ReceiptDoc,
  s: PrintSettings = readPrintSettings(),
  section?: InvoiceSection,
) {
  const pdf = buildReceiptPdf(doc, s);
  const url = pdf.output("bloburl") as unknown as string;

  // Desktop: also drop a copy in the same Invoices/ folder that Download
  // and Excel exports use, so a printed bill is still on disk afterward.
  // Kept as an un-awaited promise (not fire-and-forget void) so the two
  // branches below that need a real file path — preview and the failed-print
  // fallback — can await it without holding up the print dialog on the
  // normal, silent-print path where nobody's waiting on it. Skipped on
  // Android: that $DOCUMENT fs-scope write isn't reliable there (same
  // reasoning as downloadReceipt above), and printing shouldn't silently
  // attempt — and fail — a save the person didn't ask for. Sharing/
  // downloading the receipt already covers "get a copy on Android".
  const desktopSave =
    isDesktop() && !isAndroid()
      ? saveToInvoicesFolder(
          new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer),
          `${doc.fileName}.pdf`,
          section,
        ).catch(() => undefined)
      : undefined;

  // Falls back to a saved on-disk copy opened via the OS's own PDF handler.
  // `window.open()` on a `blob:` URL is the browser/PWA behaviour; inside
  // the Tauri/WebView2 shell it's documented-unreliable (see openExternal's
  // doc comment in desktop.ts) — and even routing through `openExternal`
  // itself wouldn't help here, since a `blob:` URL only exists inside this
  // webview's own memory and can't be handed to an external opener. Opening
  // the file that was just written to Invoices/ sidesteps both problems.
  const openSavedOrPreview = async (failureMessage: string) => {
    const savedPath = await desktopSave;
    if (savedPath) {
      try {
        const { openPath } = await import("@tauri-apps/plugin-opener");
        await openPath(savedPath);
        URL.revokeObjectURL(url);
        return;
      } catch {
        /* fall through to window.open below */
      }
    }
    const preview = window.open(url, "_blank", "noopener");
    if (!preview) {
      toast.error(failureMessage, {
        description: isDesktop()
          ? undefined
          : "Allow pop-ups for the app, then try again.",
      });
      URL.revokeObjectURL(url);
      return;
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  // "PDF print": open the PDF so the person can check the layout and print
  // it from their own PDF viewer, instead of going through a printer dialog
  // here. This is a deliberate, exclusive choice (see `printMethod` in
  // print.ts) — it never also tries the printer-dialog path below, so
  // pressing Print only ever opens the one window the person picked.
  if (s.printMethod === "pdf") {
    await openSavedOrPreview("Couldn't open receipt for printing");
    return;
  }

  // "Chosen printer (no dialog)": send the already-saved PDF straight to
  // the printer picked in Print Settings via the OS's silent PrintTo path,
  // instead of showing any dialog at all. Desktop-only, like the rasterised
  // print path below — Android keeps using its own native share/print
  // intents, which already let the person choose a printer there. This is
  // a deliberate, exclusive choice like "PDF print" above: if it fails,
  // report why and let the person switch methods themselves rather than
  // silently falling back to a dialog they didn't ask for.
  if (s.printMethod === "named-printer") {
    if (!isDesktop() || isAndroid()) {
      toast.error("Direct printer selection needs the Windows desktop app", {
        description: "Switch to PDF print or Default print in Print Settings.",
      });
      URL.revokeObjectURL(url);
      return;
    }
    const savedPath = await desktopSave;
    if (!savedPath) {
      toast.error("Couldn't save the receipt to print it", {
        description:
          "Switch to PDF print or Default print in Print Settings, then try again.",
      });
      URL.revokeObjectURL(url);
      return;
    }
    try {
      const { printFileToPrinter } = await import("./printers");
      for (
        let i = 0;
        i < Math.max(1, Math.min(5, Math.round(s.copies || 1)));
        i++
      ) {
        await printFileToPrinter(savedPath, s.selectedPrinter);
      }
    } catch (err) {
      toast.error("Couldn't print to the chosen printer", {
        description: `${err instanceof Error ? err.message : String(err)} — switch to PDF print or Default print in Print Settings, or try again.`,
        duration: 10_000,
      });
    }
    URL.revokeObjectURL(url);
    return;
  }

  const copies = Math.max(1, Math.min(5, Math.round(s.copies || 1)));
  let printed = true;

  // Desktop (Tauri/WebView2): WebView2's PDF viewer refuses a programmatic
  // print, so handing it a PDF directly never reaches a printer there.
  // Rasterising the pages and printing them as plain HTML uses the
  // webview's ordinary print pipeline instead, which does show the real
  // Windows print dialog.
  if (isDesktop() && !isAndroid()) {
    // The installed app ships without DevTools (no `devtools` Cargo
    // feature), so `console.error` here would go to a console nobody can
    // ever open — the actual reason has to reach the screen instead.
    let failureReason: string | null = null;
    try {
      printed = await printPdfBytesAsImages(
        new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer),
        copies,
      );
    } catch (err) {
      printed = false;
      failureReason = err instanceof Error ? err.message : String(err);
    }
    // Deliberately no PDF-window fallback here: the person picked "Default
    // print" (see printMethod), so silently popping a second PDF window
    // when the printer dialog fails is exactly the confusing double-window
    // behaviour this setting exists to avoid. Report the failure once and
    // let them switch to "PDF print" themselves if they'd rather do that.
    URL.revokeObjectURL(url);
    if (!printed) {
      toast.error("Couldn't open the Windows print dialog", {
        description: failureReason
          ? `${failureReason} — switch to PDF print in Print Settings, or try again.`
          : "Switch to PDF print in Print Settings, then try again.",
        duration: 10_000,
      });
    }
    return;
  }

  // Browser/PWA (not the desktop shell): the hidden-iframe print path works
  // fine there, so it stays as the "Default print" path on that platform.
  for (let i = 0; i < copies; i++) {
    printed = await printPdfFrame(url);
    if (!printed) break;
  }
  if (!printed) {
    toast.error("Couldn't open the printer dialog", {
      description: "Switch to PDF print in Print Settings, then try again.",
    });
    URL.revokeObjectURL(url);
    return;
  }
  URL.revokeObjectURL(url);
}

export async function shareReceipt(
  doc: ReceiptDoc,
  fallbackUrl: string,
  s: PrintSettings = readPrintSettings(),
  section?: InvoiceSection,
) {
  const blob = buildReceiptPdf(doc, s).output("blob");
  const file = new File([blob], `${doc.fileName}.pdf`, {
    type: "application/pdf",
  });
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  // Desktop (Tauri/WebView2, excluding Android — see below): the Web Share
  // API is not implemented in WebView2 at all, so `nav.canShare`/`nav.share`
  // are undefined and the branch below would never run anyway. More
  // importantly, the fallback's `window.open()` cannot be relied on inside a
  // Tauri webview: it either does nothing or tries to open a second webview
  // window pointed at wa.me, which is not what "share on WhatsApp" should do
  // on a desktop. So on real desktop we skip the Web Share attempt entirely,
  // save the PDF via the native dialog, and hand the WhatsApp URL to the OS
  // default browser through the opener plugin.
  //
  // Android is deliberately excluded from this branch even though it also
  // satisfies isDesktop(): Android's system WebView does implement the Web
  // Share API (including file attachments) via the OS share sheet, so it
  // should get the same "shared"/"cancelled" attempt as the browser build
  // below rather than being routed into a desktop-only save+openExternal
  // flow that used to unconditionally report "fallback" even when nothing
  // was actually attached.
  if (isDesktop() && !isAndroid()) {
    await downloadReceipt(doc, s, section);
    await openExternal(fallbackUrl);
    return "fallback";
  }
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({
        files: [file],
        title: `${BUSINESS_NAME} ${doc.docNo}`,
      });
      return "shared";
    } catch {
      return "cancelled";
    }
  }
  // Android without Web Share support (or the user's default share sheet
  // has nothing that accepts the file): save to Downloads first so there's
  // something to attach, and don't open WhatsApp if that save failed.
  if (isAndroid()) {
    const saved = await downloadReceipt(doc, s, section);
    if (!saved) return "cancelled";
    await openExternal(fallbackUrl);
    return "fallback";
  }
  downloadReceipt(doc, s, section);
  await openExternal(fallbackUrl);
  return "fallback";
}

/* ---------- document builders ---------- */

export function billReceipt(bill: Bill): ReceiptDoc {
  // Printed from the bill's own frozen tax snapshot, never recomputed at
  // print time, so a reprint after a rate change is byte-identical to the
  // copy the customer first received.
  const taxLines = billTaxLines(bill);
  const grandTotal = billGrossTotal(bill);
  const taxAmount = grandTotal - rupees(bill.total);
  const paid = billPaidAmount(bill);
  const due = Math.max(0, grandTotal - paid);
  // Narrow thermal rolls get the abbreviated unit ("2.5 L" instead of
  // "2.5 litre") in the QTY column so the value never has to be clipped with
  // an ellipsis to fit. Sheets (A4/A5/Letter) have plenty of column width and
  // keep the full unit name.
  const wide = paperInfo(readPrintSettings().paper).kind === "sheet";
  return {
    kind: "Bill",
    docNo: bill.invoice_no,
    dateText: formatDMY(bill.bill_date),
    customer: bill.customer_name,
    phone: bill.customer_phone,
    lines: [
      ...bill.items.map((it) => ({
        label: it.item || "Item",
        sub: `${it.qty} ${it.unit ?? "kg"} x ${pmoney(it.rate)}`,
        qty: `${it.qty} ${wide ? (it.unit ?? "kg") : UNIT_SHORT[it.unit ?? "kg"]}`,
        amount: it.total,
      })),
      // Itemized alongside the products, in addition to the totals block
      // below, so offer/advance show as line entries on the printed bill.
      ...(bill.discount
        ? [{ label: "Offer / Discount", amount: -bill.discount }]
        : []),
      ...(paid ? [{ label: "Advance paid", amount: -paid }] : []),
    ],
    totals: [
      { label: "Subtotal", value: pmoney(bill.subtotal) },
      ...(bill.discount
        ? [{ label: "Discount", value: "-" + pmoney(bill.discount) }]
        : []),
      // Every switched-on tax (GST plus any custom tax) is added on top of
      // the bill here — a tax that's off contributes nothing and doesn't
      // appear at all; switching one on adds its amount to the grand total.
      // GST keeps its conventional CGST/SGST split; each custom tax prints
      // as its own named line.
      ...(taxAmount > 0
        ? [
            { label: "Taxable Amount", value: pmoney(bill.total) },
            ...taxLines.map((l) => ({
              label: l.label,
              value: pmoney(l.value),
            })),
          ]
        : []),
      { label: "GRAND TOTAL", value: pmoney(grandTotal), strong: true },
      { label: "Paid", value: pmoney(paid) },
      ...(due > 0 ? [{ label: "Balance due", value: pmoney(due) }] : []),
      { label: "Status", value: bill.status.toUpperCase() },
    ],
    fileName: `${bill.invoice_no}-${bill.customer_name.replace(/\s+/g, "-")}`,
  };
}

/** "1 hr 30 min" from fractional hours. */
const durationText = (hours: number) => {
  const mins = Math.round((Number(hours) || 0) * 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h} hr ${m} min`;
  if (h > 0) return `${h} hr`;
  return `${m} min`;
};

export function bookingReceipt(b: TurfBooking): ReceiptDoc {
  const courts = b.courts ?? 1;
  const snacks = b.snacks ?? [];
  const snacksTotal = b.snacks_total ?? 0;
  // Older rows were saved with zero when turf_amount was not yet present.
  // Reconstruct that legacy value from hours × rate × courts.
  const storedTurf = Number(b.turf_amount) || 0;
  const turfAmount =
    storedTurf > 0 ? storedTurf : b.hours * b.rate_per_hour * courts;
  // GRAND TOTAL is derived from the same Turf + Snacks − Discount figure
  // printed just above it, instead of trusting `b.total_amount` blindly.
  // `total_amount` is normally created exactly this way (see TurfTab's
  // submit handler), but `snacks_total` can in principle be non-zero on a
  // row that predates that guarantee (an imported/restored booking, or a
  // future feature that populates it) — trusting `total_amount` alone in
  // that case would print a Grand Total that doesn't match the Turf/Snacks/
  // Discount lines right above it, and a Balance Due computed off the wrong
  // figure. Recomputing here keeps every printed number self-consistent.
  const taxable = bookingTaxable(b);
  // Tax applies wherever GST is switched on (Settings), not only on formal
  // Bills — and it comes from the booking's own frozen snapshot, so a reprint
  // after a rate change matches the customer's copy.
  const taxLines = taxLinesWithFallback(taxable, b);
  const grandTotal = bookingGrossTotal(b);
  const taxAmount = grandTotal - taxable;
  const due = Math.max(0, rupees(grandTotal - b.advance_paid));
  const timeText =
    b.start_time && b.end_time ? ` ${b.start_time}-${b.end_time}` : "";
  // Same narrow-roll rationale as billReceipt: abbreviate on thermal paper so
  // the QTY column never has to ellipsis-clip the value.
  const wide = paperInfo(readPrintSettings().paper).kind === "sheet";
  return {
    kind: "Booking",
    docNo: b.booking_no,
    dateText: formatDMY(b.booking_date),
    customer: b.customer_name,
    phone: b.phone,
    lines: [
      {
        label: `${b.slot_name} slot${timeText}`,
        sub: durationText(b.hours),
        qty: wide ? `${courts} court${courts > 1 ? "s" : ""}` : `${courts} crt`,
        amount: turfAmount,
      },
      ...snacks.map((it) => ({
        label: it.item_name,
        sub: `x ${pmoney(it.unit_price)}`,
        qty: it.qty,
        amount: it.amount,
      })),
      // Offer/discount and advance paid are itemized here too (not just in
      // the totals block below) so they're visible as line-by-line entries
      // on the printed receipt, matching how turf/snack items are shown.
      ...(b.discount
        ? [{ label: "Offer / Discount", amount: -b.discount }]
        : []),
      ...(b.advance_paid
        ? [{ label: "Advance paid", amount: -b.advance_paid }]
        : []),
    ],
    totals: [
      { label: "Turf", value: pmoney(turfAmount) },
      ...(snacksTotal ? [{ label: "Snacks", value: pmoney(snacksTotal) }] : []),
      ...(b.discount
        ? [{ label: "Discount", value: "-" + pmoney(b.discount) }]
        : []),
      ...(taxAmount > 0
        ? [
            { label: "Taxable Amount", value: pmoney(taxable) },
            ...taxLines.map((l) => ({
              label: l.label,
              value: pmoney(l.value),
            })),
          ]
        : []),
      { label: "GRAND TOTAL", value: pmoney(grandTotal), strong: true },
      { label: "Paid", value: pmoney(b.advance_paid) },
      ...(due ? [{ label: "Balance due", value: pmoney(due) }] : []),
      { label: "Mode", value: b.payment_mode },
      { label: "Status", value: b.status },
    ],
    note: b.notes,
    fileName: `${b.booking_no}-${b.customer_name.replace(/\s+/g, "-")}`,
  };
}

export function snackSaleReceipt(s: SnackSale): ReceiptDoc {
  const taxLines = taxLinesWithFallback(s.total, s);
  const grandTotal = snackSaleGrossTotal(s);
  const taxAmount = grandTotal - rupees(s.total);
  return {
    kind: "Bill",
    docNo: s.bill_no,
    dateText: formatDMY(s.sale_date),
    customer: s.customer_name,
    lines: s.items.map((it) => ({
      label: it.item_name,
      sub: `x ${pmoney(it.unit_price)}`,
      qty: it.qty,
      amount: it.amount,
    })),
    totals: [
      ...(taxAmount > 0
        ? [
            { label: "Taxable Amount", value: pmoney(s.total) },
            ...taxLines.map((l) => ({
              label: l.label,
              value: pmoney(l.value),
            })),
          ]
        : []),
      { label: "GRAND TOTAL", value: pmoney(grandTotal), strong: true },
      { label: "Mode", value: s.payment_mode },
      ...(s.booking_no
        ? [{ label: "Linked booking", value: s.booking_no }]
        : []),
    ],
    note: s.notes,
    fileName: `${s.bill_no}-snacks`,
  };
}

/** Compact `PREFIX-DDMMYY-HHMMSS` doc number for receipts that aren't tied
 * to a stored record with its own invoice/booking/bill number — a payment
 * collection or a customer statement is generated at print time, not saved,
 * so there's no natural id to reuse. Includes time-of-day (not just date)
 * so two same-day payments against the same customer don't share a docNo. */
const generatedDocNo = (prefix: string, d = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${prefix}-${pad(d.getDate())}${pad(d.getMonth() + 1)}${String(d.getFullYear()).slice(-2)}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
};

/** Receipt for a payment collected against a customer's outstanding
 * balance — either one line/booking's due (Customer detail dialog's
 * per-line "Collect") or the whole balance at once (`useSettleCustomer`'s
 * "Settle all"). Unlike `billReceipt`/`bookingReceipt`, there's no single
 * stored record this prints from: `against` names what the payment covers
 * in plain text (e.g. "Booking TB-0012", "Full balance") and `balanceAfter`
 * is what's left once this payment lands. */
export function paymentReceipt(p: {
  customer: string;
  phone?: string | null;
  against: string;
  amount: number;
  mode: string;
  balanceAfter: number;
}): ReceiptDoc {
  const now = new Date();
  const docNo = generatedDocNo("PAY", now);
  return {
    kind: "Payment",
    docNo,
    dateText: formatDMY(now.toISOString()),
    customer: p.customer,
    phone: p.phone ?? null,
    lines: [{ label: p.against, amount: p.amount }],
    totals: [
      { label: "Amount received", value: pmoney(p.amount), strong: true },
      { label: "Mode", value: p.mode },
      { label: "Balance remaining", value: pmoney(p.balanceAfter) },
    ],
    fileName: `${docNo}-${p.customer.replace(/\s+/g, "-")}`,
  };
}

/** Full account-statement receipt for one customer — every bill, booking,
 * and snack-sale line together (already merged and date-sorted by the
 * caller) plus running totals, for the Customer detail dialog's "Print
 * statement" action. Each line's `sub` carries the original date and status
 * since a statement, unlike a single bill, spans many dates at once. */
export function customerStatementReceipt(p: {
  customer: string;
  phone?: string | null;
  lines: { label: string; date: string; amount: number; status: string }[];
  totalSpent: number;
  totalPaid: number;
  totalOutstanding: number;
}): ReceiptDoc {
  const now = new Date();
  const docNo = generatedDocNo("STMT", now);
  return {
    kind: "Statement",
    docNo,
    dateText: formatDMY(now.toISOString()),
    customer: p.customer,
    phone: p.phone ?? null,
    lines: p.lines.map((l) => ({
      label: l.label,
      sub: `${formatDMY(l.date)} · ${l.status}`,
      amount: l.amount,
    })),
    totals: [
      { label: "Total spent", value: pmoney(p.totalSpent) },
      { label: "Total paid", value: pmoney(p.totalPaid) },
      {
        label: "Outstanding",
        value: pmoney(p.totalOutstanding),
        strong: true,
      },
    ],
    fileName: `${docNo}-${p.customer.replace(/\s+/g, "-")}`,
  };
}

/** Plain-text version, used for WhatsApp / copy actions. */
export function receiptText(doc: ReceiptDoc) {
  return [
    readPrintSettings().shopName.trim() || BUSINESS_NAME,

    `${doc.kind} ${doc.docNo} · ${doc.dateText}`,
    doc.customer ? `Customer: ${doc.customer}` : "",
    "",
    ...doc.lines.map(
      (l) =>
        `${l.label}${l.sub ? ` — ${l.sub}` : ""}${l.amount !== undefined ? ` = ${money(l.amount)}` : ""}`,
    ),
    "",
    ...doc.totals.map((t) => `${t.label}: ${t.value}`),
    doc.note ? `Note: ${doc.note}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ---------- backwards-compatible bill helpers ---------- */

export const buildBillPdf = (bill: Bill) => buildReceiptPdf(billReceipt(bill));
export const downloadBillPdf = (bill: Bill, section?: InvoiceSection) =>
  downloadReceipt(billReceipt(bill), readPrintSettings(), section);
export const printBillPdf = (bill: Bill, section?: InvoiceSection) =>
  printReceipt(billReceipt(bill), readPrintSettings(), section);
export const shareBillPdf = (
  bill: Bill,
  fallbackUrl: string,
  section?: InvoiceSection,
) => shareReceipt(billReceipt(bill), fallbackUrl, readPrintSettings(), section);
