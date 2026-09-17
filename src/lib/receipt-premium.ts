import { jsPDF } from "jspdf";
import { rupees } from "./money";
import type { ReceiptDoc } from "./receipt";
import { paperInfo, paperWidthMm, type PrintSettings } from "./print";
import { drawUpiPanel, estimateUpiPanelHeight } from "./receipt-upi";

/**
 * "Premium" receipt/invoice templates — the boxed, two-tone, letterhead-style
 * layouts (as opposed to the plain ruled-line "classic" layout in receipt.ts).
 * Covers 5 of the reference formats: A4 (full letterhead), A5 (compact single
 * column), 80mm thermal in color, 80mm thermal in black & white, and a
 * condensed 58mm POS slip. Letter/76mm/custom-width paper falls back to the
 * classic renderer (returns null here) since there's no dedicated layout for
 * them yet.
 *
 * Kept in its own file (rather than folded into receipt.ts's renderBody) so
 * the two rendering styles don't share mutable state or drawing helpers —
 * each is a complete, from-scratch pass over the same ReceiptDoc/PrintSettings
 * inputs the classic renderer uses.
 */

const NAVY: [number, number, number] = [24, 40, 79];
const GOLD: [number, number, number] = [199, 161, 60];
const LIGHT_FILL: [number, number, number] = [242, 244, 248];
const GREEN: [number, number, number] = [30, 130, 76];
const RED: [number, number, number] = [190, 40, 40];
const RULE: [number, number, number] = [205, 208, 214];

const imgFormat = (dataUrl: string): "PNG" | "JPEG" =>
  dataUrl.startsWith("data:image/jpeg") ? "JPEG" : "PNG";

/** Shrinks `text` (with the CURRENT font/size already applied on `pdf`) down
 * to fit `maxW` mm by dropping trailing characters and adding "…", instead
 * of either overflowing a narrow column or chopping at some fixed character
 * count that has no relationship to the actual glyph widths (a handful of
 * "i"s and a handful of "W"s are not the same width). Mirrors the
 * `fitToWidth` helper in receipt.ts's classic renderer. */
const fitTextToWidth = (pdf: jsPDF, text: string, maxW: number): string => {
  const safeMaxW = Math.max(4, maxW);
  if (pdf.getTextWidth(text) <= safeMaxW) return text;
  let t = text;
  while (t.length > 1 && pdf.getTextWidth(`${t}…`) > safeMaxW)
    t = t.slice(0, -1);
  return `${t}…`;
};

const pmoney = (n: number, symbol: string) => {
  const v = rupees(n);
  const sym = (symbol || "Rs").trim();
  const prefix = sym ? `${sym} ` : "";
  return (v < 0 ? "-" : "") + prefix + Math.abs(v).toLocaleString("en-IN");
};

/* The QR itself, the UPI payload and the whole "Scan & Pay" panel live in
 * receipt-upi.ts so every paper size prints the identical block. */

/** Entry point. Returns null when the current paper has no premium layout
 * (caller falls back to the classic renderer). */
export function buildPremiumReceiptPdf(
  doc: ReceiptDoc,
  s: PrintSettings,
): jsPDF | null {
  const paper = paperInfo(s.paper);
  if (paper.id === "a4") return renderBoxed(doc, s, "a4");
  if (paper.id === "a5") return renderBoxed(doc, s, "a5");
  if (paper.id === "80mm") return renderBoxed(doc, s, "roll");
  if (paper.id === "58mm" || paper.id === "50mm")
    return renderCondensed(doc, s);
  return null;
}

/* ---------------------------------------------------------------------- */
/* A4 / A5 / 80mm-roll boxed layout                                        */
/* ---------------------------------------------------------------------- */

/** "roll" here always means 80mm — the one roll width the boxed layout is
 * designed for (58/50mm goes to the condensed layout instead; it's too
 * narrow for two-column cards). A4/A5 are always full color (`wide` below);
 * the 80mm roll's color vs. black-and-white treatment is the explicit
 * `s.thermalColorMode` setting — real thermal rolls are monochrome hardware,
 * so it defaults to "bw", with "color" available for an actual color
 * receipt printer or a screen/WhatsApp copy. */
function renderBoxed(
  doc: ReceiptDoc,
  s: PrintSettings,
  kind: "a4" | "a5" | "roll",
): jsPDF {
  const wide = kind === "a4" || kind === "a5";
  const width = wide ? paperInfo(s.paper).widthMm : paperWidthMm(s);
  let scale = s.fontScale || 1;
  const sym = s.currencySymbol;
  const wantColor = wide || s.thermalColorMode === "color";
  const navy = wantColor ? NAVY : ([40, 40, 40] as [number, number, number]);
  const gold = wantColor ? GOLD : ([90, 90, 90] as [number, number, number]);
  const fill = wantColor
    ? LIGHT_FILL
    : ([238, 238, 238] as [number, number, number]);
  const green = wantColor ? GREEN : ([50, 50, 50] as [number, number, number]);
  const red = wantColor ? RED : ([70, 70, 70] as [number, number, number]);

  const marginX = wide ? (kind === "a4" ? 14 : 10) : 5;
  const contentW = width - marginX * 2;
  const money = (v: number) => pmoney(v, sym);

  const renderBody = (pdf: jsPDF, pageH: number, includeUpi = true): number => {
    let y = 0;
    const headerFont = wide ? (kind === "a4" ? 20 : 15) : 11;
    const bodyFont = wide ? (kind === "a4" ? 10 : 8.5) : 7.5;
    const smallFont = wide ? (kind === "a4" ? 8 : 7) : 6;

    // Footer band content + height, computed up front (rather than at draw
    // time) so both the UPI-panel QR-shrink sizing below AND the final
    // footer draw agree on the same footH. A4/A5 have a *fixed* page height
    // and the footer band used to be a fixed 12mm regardless of content — a
    // long, wrapped shop address (the common case; see the default address
    // in DEFAULT_PRINT_SETTINGS) ran past that fixed band and straight
    // through the footer line printed underneath it.
    const footerText = [
      s.footerLine,
      s.shopPhone && s.showPhone ? `Ph: ${s.shopPhone}` : "",
    ]
      .filter(Boolean)
      .join("   ·   ");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(smallFont * scale);
    const addrLines =
      wide && s.shopAddress
        ? (pdf.splitTextToSize(s.shopAddress, contentW) as string[])
        : [];
    const addrLineH = smallFont * scale * 0.55;
    const footPad = wide ? 3 : 2.5;
    const minFootH = wide ? 12 : 8;
    const footContentH =
      addrLines.length * addrLineH +
      (addrLines.length && footerText ? 1.5 : 0) +
      (footerText ? smallFont * scale * 0.6 : 0);
    const footH =
      addrLines.length || footerText
        ? Math.max(minFootH, footContentH + footPad * 2)
        : minFootH;

    // Header band. Base height for a single-line shop name; grows below if
    // the name wraps, so the header line / doc-kind title never land on top
    // of a wrapped second line (previously they were drawn at a fixed
    // offset that assumed the shop name was always one line).
    const baseHeaderH = wide ? (kind === "a4" ? 34 : 26) : 22;

    const logo = s.logo;
    const logoH = baseHeaderH - (wide ? 12 : 8);
    let textLeftX = marginX;
    if (s.showLogo && logo) {
      const logoW = logoH * (logo.width / logo.height);
      textLeftX = marginX + logoW + (wide ? 5 : 3);
    }

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(headerFont * scale);
    const shopName = (s.shopName || "Receipt").toUpperCase();
    // Wide layouts (A4/A5) have vertical room to wrap the shop name onto a
    // second line; the roll header doesn't, so it stays single-line there
    // (long names get clipped by jsPDF's maxWidth as before).
    const nameMaxW = wide
      ? contentW * 0.6
      : Math.max(4, width - textLeftX - marginX);
    let nameLines = wide
      ? (pdf.splitTextToSize(shopName, nameMaxW) as string[])
      : [fitTextToWidth(pdf, shopName, nameMaxW)];
    if (nameLines.length > 2) {
      nameLines = nameLines.slice(0, 2);
      nameLines[1] = `${(nameLines[1] ?? "").replace(/\s+\S*$/, "")}…`;
    }
    const nameLineH = headerFont * scale * 0.42; // mm per line at this font size
    const headerH = baseHeaderH + (nameLines.length - 1) * nameLineH;

    pdf.setFillColor(...navy);
    pdf.rect(0, 0, width, headerH, "F");
    pdf.setFillColor(...gold);
    pdf.rect(0, headerH - 1.6, width, 1.6, "F");
    if (s.showLogo && logo) {
      const logoW = logoH * (logo.width / logo.height);
      pdf.addImage(
        logo.dataUrl,
        imgFormat(logo.dataUrl),
        marginX,
        (headerH - logoH) / 2,
        logoW,
        logoH,
      );
    }

    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(headerFont * scale);
    const nameBlockH = nameLines.length * nameLineH;
    let nameY = (headerH - nameBlockH) / 2 + nameLineH * 0.75;
    for (const line of nameLines) {
      pdf.text(line, textLeftX, nameY);
      nameY += nameLineH;
    }
    if (s.headerLine) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(smallFont * scale);
      pdf.text(
        fitTextToWidth(
          pdf,
          s.headerLine,
          Math.max(4, width - textLeftX - marginX),
        ),
        textLeftX,
        nameY + (wide ? 1 : 0.5),
      );
    }
    // Doc-kind title, right-aligned in the header (wide layouts only — no
    // room for it on an 80mm roll header without crowding the shop name).
    if (wide) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize((kind === "a4" ? 22 : 16) * scale);
      pdf.text(doc.kind.toUpperCase(), width - marginX, headerH / 2 + 2, {
        align: "right",
      });
    }
    y = headerH + (wide ? 8 : 5);

    // Status badge (PAID / UNPAID / PARTIAL / etc.) — pulled from the last
    // totals row whose label is exactly "Status", same source classic uses.
    const statusRow = doc.totals.find((t) => t.label === "Status");
    const statusVal = (statusRow?.value || "").toUpperCase();
    const statusColor: [number, number, number] =
      statusVal === "PAID" ? green : statusVal === "UNPAID" ? red : gold;

    // Doc-info strip (on narrow roll, since there's no header title row).
    if (!wide) {
      pdf.setTextColor(30, 30, 30);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11 * scale);
      const statusReserve = statusVal ? Math.min(contentW * 0.4, 18) : 0;
      pdf.text(
        fitTextToWidth(
          pdf,
          `${doc.kind.toUpperCase()} · ${doc.docNo}`,
          contentW - statusReserve,
        ),
        marginX,
        y,
      );
      if (statusVal) {
        pdf.setFontSize(7 * scale);
        const w = pdf.getTextWidth(statusVal) + 4;
        pdf.setFillColor(...statusColor);
        pdf.roundedRect(width - marginX - w, y - 3.6, w, 5, 1, 1, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.text(statusVal, width - marginX - w / 2, y - 0.2, {
          align: "center",
        });
      }
      y += 5;
      pdf.setDrawColor(...RULE);
      pdf.setLineDashPattern([1, 1], 0);
      pdf.line(marginX, y, width - marginX, y);
      pdf.setLineDashPattern([], 0);
      y += 4;
    }

    // Two boxed info cards: Bill To / Booking details. On the roll, these
    // stack instead of sitting side by side — no room for two columns.
    const cardGap = wide ? 4 : 0;
    const cardW = wide ? (contentW - cardGap) / 2 : contentW;
    // Takes its top-left corner explicitly (cardY) rather than reading the
    // enclosing `y` from closure — wide layouts place both cards at the SAME
    // y (side by side), but the narrow roll stacks them (one below the
    // other), so the caller needs to pass a different y for the second card
    // in that case. Reading `y` implicitly here previously drew both narrow
    // cards on top of each other at an identical position.
    const drawCard = (
      cardX: number,
      cardY: number,
      title: string,
      rows: { label: string; value: string }[],
    ): number => {
      const rowH = (wide ? 5.5 : 4.4) * scale;
      const pad = 3;
      // A blank title (the roll layout's second card — see `infoRows` below)
      // doesn't get a heading line drawn, so it shouldn't reserve a full
      // rowH of blank space above its rows either; that used to just be dead
      // air on top of the roll's "Details" card for no visible reason.
      const titleH = title ? rowH : 0;
      const h = pad * 2 + titleH + rowH * rows.length + 5;
      pdf.setFillColor(...fill);
      pdf.setDrawColor(...RULE);
      pdf.roundedRect(cardX, cardY, cardW, h, 1.5, 1.5, "FD");
      if (title) {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize((wide ? 8 : 6.5) * scale);
        pdf.setTextColor(...navy);
        pdf.text(title.toUpperCase(), cardX + pad, cardY + pad + 2);
      }
      let ry = cardY + pad + 2 + titleH;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(bodyFont * scale);
      pdf.setTextColor(40, 40, 40);
      for (const row of rows) {
        pdf.setFont("helvetica", "bold");
        const label = fitTextToWidth(pdf, row.label, Math.max(4, cardW * 0.28));
        pdf.text(label, cardX + pad, ry);
        // Measure the label while still bold — bold glyphs are wider than
        // normal ones, so switching to "normal" before measuring (as this
        // used to) under-measured the label and placed the value text
        // partway on top of it on every single row of every info card.
        const labelW = pdf.getTextWidth(label);
        pdf.setFont("helvetica", "normal");
        const valueX = cardX + pad + labelW;
        const valueMaxW = Math.max(4, cardW - pad - valueX + cardX);
        pdf.text(fitTextToWidth(pdf, `: ${row.value}`, valueMaxW), valueX, ry);
        ry += rowH;
      }
      return h;
    };

    const billRows = [
      ...(doc.customer ? [{ label: "Name", value: doc.customer }] : []),
      ...(doc.phone && s.showPhone
        ? [{ label: "Phone", value: doc.phone }]
        : []),
      ...(doc.email ? [{ label: "Email", value: doc.email }] : []),
    ];
    const infoRows = [
      { label: "Date", value: doc.dateText },
      { label: `${doc.kind} No.`, value: doc.docNo },
      ...(statusVal && wide ? [{ label: "Status", value: statusVal }] : []),
    ];

    if (billRows.length || infoRows.length) {
      const h1 = billRows.length
        ? drawCard(marginX, y, "Bill To", billRows)
        : 0;
      const secondX = wide ? marginX + cardW + cardGap : marginX;
      const secondY = wide ? y : y + h1 + (h1 ? 3 : 0);
      const h2 = infoRows.length
        ? drawCard(secondX, secondY, wide ? "Details" : "", infoRows)
        : 0;
      y += wide ? Math.max(h1, h2) + 6 : h1 + (h1 ? 3 : 0) + h2 + 4;
    }

    // Item table — shaded navy header, zebra rows.
    const noColW = wide ? 8 : 6;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(bodyFont * scale);
    const qtyTexts = doc.lines.map((line) =>
      line.qty === undefined ? "" : String(line.qty),
    );
    const amountTexts = doc.lines.map((line) => money(line.amount ?? 0));
    const widest = (values: string[]) =>
      Math.max(...values.map((value) => pdf.getTextWidth(value)));
    const qtyColW = Math.min(
      contentW * (wide ? 0.24 : 0.35),
      Math.max(7 * scale, widest(["QTY", ...qtyTexts])),
    );
    const amtColW = Math.min(
      Math.max(contentW - noColW - 6, 12 * scale),
      Math.max(12 * scale, widest([wide ? "AMOUNT" : "AMT", ...amountTexts])),
    );
    const columnGap = wide ? 2 * scale : 1 * scale;
    const labelColW = contentW - noColW - qtyColW - amtColW - columnGap;
    const rowH = (wide ? 6.5 : 5) * scale;
    const headerBandH = (wide ? 7 : 5.5) * scale;

    pdf.setFillColor(...navy);
    pdf.rect(marginX, y, contentW, headerBandH, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize((wide ? 8.5 : 6.5) * scale);
    const midY = y + headerBandH / 2 + 1.2;
    // Narrow "roll" (80mm) paper needs the same short-form header the
    // classic (receipt.ts) and condensed (58/50mm) renderers already use —
    // the full word doesn't fit the shrunken column and used to bleed left
    // into the QTY header.
    const amountHeader = wide ? "AMOUNT" : "AMT";
    pdf.text("#", marginX + 2, midY);
    pdf.text("DESCRIPTION", marginX + noColW, midY);
    pdf.text("QTY", marginX + noColW + labelColW + qtyColW, midY, {
      align: "right",
    });
    pdf.text(amountHeader, width - marginX - 1, midY, { align: "right" });
    y += headerBandH;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(bodyFont * scale);
    doc.lines.forEach((line, i) => {
      const rawLines = pdf.splitTextToSize(
        line.label,
        labelColW - 2,
      ) as string[];
      // Only ever show 2 lines of a wrapped description (with an ellipsis on
      // the 2nd if there was more) — bandH below was already sized for up to
      // 2 lines, but previously only rawLines[0] was ever drawn, silently
      // dropping the wrapped remainder of any item name that didn't fit on
      // one line.
      const shownLines = rawLines.slice(0, 2);
      if (rawLines.length > 2) {
        shownLines[1] = `${(shownLines[1] ?? "").replace(/\s+\S*$/, "")}…`;
      }
      const nLines = shownLines.length + (line.sub ? 1 : 0);
      const bandH = rowH * Math.max(1, nLines * 0.72);
      if (i % 2 === 1) {
        pdf.setFillColor(...fill);
        pdf.rect(marginX, y, contentW, bandH, "F");
      }
      pdf.setTextColor(30, 30, 30);
      const ty = y + rowH * 0.62;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(bodyFont * scale);
      pdf.text(String(i + 1), marginX + 2, ty);
      shownLines.forEach((lbl, li) => {
        pdf.text(lbl, marginX + noColW, ty + li * rowH * 0.62);
      });
      pdf.text(
        fitTextToWidth(
          pdf,
          line.qty !== undefined ? String(line.qty) : "",
          qtyColW - 1,
        ),
        marginX + noColW + labelColW + qtyColW,
        ty,
        { align: "right" },
      );
      pdf.text(
        fitTextToWidth(pdf, money(line.amount ?? 0), amtColW - 1),
        width - marginX - 1,
        ty,
        { align: "right" },
      );
      if (line.sub) {
        // Sits below however many description lines actually printed, not a
        // fixed offset — otherwise a wrapped 2nd line and the sub line
        // landed on top of each other.
        const subY = ty + shownLines.length * rowH * 0.62;
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize((wide ? 7.5 : 6) * scale);
        pdf.setTextColor(110, 110, 110);
        pdf.text(
          fitTextToWidth(pdf, line.sub, labelColW - 2),
          marginX + noColW,
          subY,
        );
        pdf.setFontSize(bodyFont * scale);
      }
      pdf.setDrawColor(...RULE);
      pdf.line(marginX, y + bandH, width - marginX, y + bandH);
      y += bandH;
    });
    y += wide ? 4 : 3;

    // Totals — right-aligned box, grand total picked out in the navy bar.
    const totalsW = wide ? contentW * 0.46 : contentW;
    const totalsX = width - marginX - totalsW;
    const grand = doc.totals.find((t) => t.strong);
    const otherTotals = doc.totals.filter(
      (t) => t !== grand && t.label !== "Status",
    );
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(bodyFont * scale);
    for (const t of otherTotals) {
      const isDiscount = t.value.trim().startsWith("-");
      pdf.setTextColor(
        isDiscount ? red[0] : 60,
        isDiscount ? red[1] : 60,
        isDiscount ? red[2] : 60,
      );
      const value = fitTextToWidth(pdf, t.value, Math.max(4, totalsW - 6));
      const valueW = pdf.getTextWidth(value);
      pdf.text(
        fitTextToWidth(pdf, t.label, Math.max(4, totalsW - valueW - 8)),
        totalsX,
        y,
      );
      pdf.text(value, width - marginX, y, { align: "right" });
      y += rowH * 0.8;
    }
    if (grand) {
      y += 1;
      const barH = (wide ? 9 : 7) * scale;
      pdf.setFillColor(...navy);
      pdf.rect(totalsX, y, totalsW, barH, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize((wide ? 11 : 9) * scale);
      const grandValue = fitTextToWidth(
        pdf,
        grand.value,
        Math.max(4, totalsW - 6),
      );
      const grandValueW = pdf.getTextWidth(grandValue);
      pdf.text(
        fitTextToWidth(
          pdf,
          grand.label,
          Math.max(4, totalsW - grandValueW - 8),
        ),
        totalsX + 3,
        y + barH / 2 + 1.4,
      );
      pdf.text(grandValue, width - marginX - 3, y + barH / 2 + 1.4, {
        align: "right",
      });
      y += barH;
    }
    y += wide ? 6 : 5;

    let deferredUpi = false;

    // Payment / QR panel — only when a UPI ID is configured. Drawn by the
    // shared drawUpiPanel (receipt-upi.ts) so A4/A5/80mm/58mm all render the
    // identical amount-free "Scan & Pay" block.
    if (includeUpi && s.upiId.trim()) {
      const balanceRow = doc.totals.find((t) => t.label === "Balance due");
      const hasBalance = !!balanceRow;
      const paidFlag = statusVal === "PAID";
      // A4 has room to spare, but A5's fixed sheet height (unlike the roll
      // layouts below, which grow the page to fit) means the full-size
      // panel can run into the footer band on a normal-length bill. Shrink
      // the QR just enough to clear the space actually left above the
      // footer, rather than hardcoding a smaller size for "a5" that would
      // either waste room on a short bill or still overflow a long one.
      let qrSize: number | undefined;
      if (wide) {
        const bottomBuffer = 2;
        const available = pageH - footH - bottomBuffer - y;
        const maxQr = 30;
        const minQr = 10;
        let candidate = maxQr;
        while (candidate > minQr) {
          const h = estimateUpiPanelHeight({
            width: contentW,
            scale,
            variant: "wide",
            qrSize: candidate,
            hasBalance,
            paid: paidFlag,
          });
          if (h <= available) break;
          candidate -= 1;
        }
        qrSize = candidate;
      }
      const requiredPanelH = estimateUpiPanelHeight({
        width: contentW,
        scale,
        variant: wide ? "wide" : "roll",
        qrSize,
        hasBalance,
        paid: paidFlag,
      });
      // A5 is a fixed-height sheet. If a long bill leaves less room than the
      // smallest readable QR panel, never draw a partial card under the
      // footer; move the payment panel to a clean second A5 page instead.
      if (wide && y + requiredPanelH > pageH - footH - 2) {
        deferredUpi = true;
      } else {
        const panelH = drawUpiPanel(pdf, {
          x: marginX,
          y,
          width: contentW,
          upiId: s.upiId,
          payeeName: s.shopName,
          reference: doc.docNo,
          balanceText: balanceRow?.value ?? null,
          status: statusVal,
          scale,
          variant: wide ? "wide" : "roll",
          mono: !wantColor,
          apps: s.upiApps,
          navy,
          gold,
          fill,
          green,
          ...(qrSize !== undefined ? { qrSize } : {}),
        });
        y += panelH + (wide ? 6 : 5);
      }
    }

    if (doc.note) {
      pdf.setFont("helvetica", "italic");
      pdf.setFontSize(smallFont * scale);
      pdf.setTextColor(90, 90, 90);
      const noteLines = pdf.splitTextToSize(
        `Note: ${doc.note}`,
        contentW,
      ) as string[];
      for (const line of noteLines) {
        pdf.text(line, marginX, y);
        y += smallFont * scale * 0.5;
      }
      y += 3;
    }

    // Footer band — footerText/addrLines/footH were computed up front (see
    // above) so this always has room for however many lines the address
    // actually wrapped to.
    if (footerText || addrLines.length) {
      pdf.setFillColor(...navy);
      pdf.rect(0, pageH - footH, width, footH, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(smallFont * scale);
      let fy = pageH - footH + footPad + smallFont * scale * 0.45;
      for (const line of addrLines) {
        pdf.text(line, width / 2, fy, { align: "center" });
        fy += addrLineH;
      }
      if (addrLines.length && footerText) fy += 1.5;
      if (footerText) {
        pdf.text(fitTextToWidth(pdf, footerText, contentW), width / 2, fy, {
          align: "center",
        });
      }
    }

    if (deferredUpi) {
      // Keep the bill page clean and give the QR its own complete sheet when
      // the fixed A5/A4 page has no remaining vertical capacity.
      pdf.addPage([width, pageH]);
      const paymentY = kind === "a4" ? 24 : 18;
      const balanceRow = doc.totals.find((t) => t.label === "Balance due");
      const paidFlag = statusVal === "PAID";
      const panelH = drawUpiPanel(pdf, {
        x: marginX,
        y: paymentY,
        width: contentW,
        upiId: s.upiId,
        payeeName: s.shopName,
        reference: doc.docNo,
        balanceText: balanceRow?.value ?? null,
        status: statusVal,
        scale,
        variant: "wide",
        apps: s.upiApps,
        navy,
        gold,
        fill,
        green,
        qrSize: kind === "a4" ? 30 : 24,
      });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(smallFont * scale);
      pdf.setTextColor(...navy);
      pdf.text("Payment details", width / 2, paymentY - 7, { align: "center" });
      // The second page uses the same footer geometry as the bill page.
      if (footerText || addrLines.length) {
        pdf.setFillColor(...navy);
        pdf.rect(0, pageH - footH, width, footH, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(smallFont * scale);
        let fy = pageH - footH + footPad + smallFont * scale * 0.45;
        for (const line of addrLines) {
          pdf.text(line, width / 2, fy, { align: "center" });
          fy += addrLineH;
        }
        if (addrLines.length && footerText) fy += 1.5;
        if (footerText) {
          pdf.text(fitTextToWidth(pdf, footerText, contentW), width / 2, fy, {
            align: "center",
          });
        }
      }
      y = Math.max(y, paymentY + panelH);
    }

    return y;
  };

  if (wide) {
    const height = paperInfo(s.paper).heightMm!;
    // Fixed A4/A5 sheets must reserve space for the footer. Measure once and
    // reduce the complete layout proportionally for unusually long bills
    // rather than allowing totals to disappear underneath the footer.
    const probe = new jsPDF({ unit: "mm", format: [width, height] });
    const measured = renderBody(probe, height, false);
    const usableHeight = height - (wide ? 28 : 14);
    if (measured > usableHeight) {
      scale = Math.max(0.72, scale * (usableHeight / measured));
    }
    const pdf = new jsPDF({ unit: "mm", format: [width, height] });
    renderBody(pdf, height);
    return pdf;
  }

  const SCRATCH = 3000;
  const scratch = new jsPDF({ unit: "mm", format: [width, SCRATCH] });
  const measured = renderBody(scratch, SCRATCH);
  const height = measured + 14; // room for the footer band + cut feed
  const pdf = new jsPDF({ unit: "mm", format: [width, height] });
  renderBody(pdf, height);
  return pdf;
}

/* ---------------------------------------------------------------------- */
/* 58mm / 50mm condensed POS slip                                          */
/* ---------------------------------------------------------------------- */

function renderCondensed(doc: ReceiptDoc, s: PrintSettings): jsPDF {
  const width = paperWidthMm(s);
  const scale = s.fontScale || 1;
  const marginX = 4;
  const contentW = width - marginX * 2;
  const sym = s.currencySymbol;
  const money = (v: number) => pmoney(v, sym);

  const renderBody = (pdf: jsPDF, pageH: number): number => {
    let y = 6;
    const titleFont = 10 * scale;
    const bodyFont = 7 * scale;
    const smallFont = 6 * scale;

    if (s.showLogo && s.logo) {
      const logoH = 12;
      const logoW = logoH * (s.logo.width / s.logo.height);
      pdf.addImage(
        s.logo.dataUrl,
        imgFormat(s.logo.dataUrl),
        (width - logoW) / 2,
        y,
        logoW,
        logoH,
      );
      y += logoH + 2;
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(titleFont);
    pdf.setTextColor(20, 20, 20);
    const nameLines = pdf.splitTextToSize(
      (s.shopName || "Receipt").toUpperCase(),
      contentW,
    ) as string[];
    for (const line of nameLines) {
      pdf.text(line, width / 2, y, { align: "center" });
      y += titleFont * 0.45;
    }
    if (s.headerLine) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(smallFont);
      pdf.text(fitTextToWidth(pdf, s.headerLine, contentW), width / 2, y, {
        align: "center",
      });
      y += smallFont * 0.55;
    }
    y += 1;
    pdf.setDrawColor(...RULE);
    pdf.setLineDashPattern([1, 0.8], 0);
    pdf.line(marginX, y, width - marginX, y);
    pdf.setLineDashPattern([], 0);
    y += 4;

    const field = (label: string, value: string) => {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(bodyFont);
      pdf.setTextColor(20, 20, 20);
      pdf.text(`${label}:`, marginX, y);
      // Same fix as the wide info cards above: measure while still bold,
      // since the label was just drawn bold and normal-weight glyphs
      // measure narrower, which pushed the value left into the label.
      const labelW = pdf.getTextWidth(`${label}: `);
      pdf.setFont("helvetica", "normal");
      const maxW = contentW - labelW;
      pdf.text(fitTextToWidth(pdf, value, maxW), marginX + labelW, y);
      y += bodyFont * 0.6;
    };
    field("INV", doc.docNo);
    field("DATE", doc.dateText);
    if (doc.customer) field("CUST", doc.customer);
    if (doc.phone && s.showPhone) field("PH", doc.phone);
    y += 1;
    pdf.setLineDashPattern([1, 0.8], 0);
    pdf.line(marginX, y, width - marginX, y);
    pdf.setLineDashPattern([], 0);
    y += 4;

    // Column widths are measured from the actual content (qty values, amounts)
    // rather than a fixed guess — a hardcoded qty-column width here previously
    // risked crowding into the item description on the narrowest paper (50mm,
    // contentW ~42mm), the same trap the classic renderer's item table already
    // avoids by measuring real text widths instead of assuming a column size.
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(smallFont);
    const qtyTexts = doc.lines.map((l) =>
      l.qty !== undefined ? String(l.qty) : "",
    );
    const amtTexts = doc.lines.map((l) => money(l.amount ?? 0));
    const qtyColW =
      Math.max(
        pdf.getTextWidth("QTY"),
        ...qtyTexts.map((t) => pdf.getTextWidth(t)),
      ) + 1;
    const amtColW =
      Math.max(
        pdf.getTextWidth("AMT"),
        ...amtTexts.map((t) => pdf.getTextWidth(t)),
      ) + 1;
    const amtX = width - marginX;
    const qtyX = amtX - amtColW - 3;
    const labelMaxW = Math.max(10, qtyX - qtyColW - 3 - marginX);
    pdf.text(fitTextToWidth(pdf, "ITEM", labelMaxW), marginX, y);
    pdf.text("QTY", qtyX, y, { align: "right" });
    pdf.text("AMT", amtX, y, { align: "right" });
    y += bodyFont * 0.6;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(bodyFont);
    doc.lines.forEach((line, i) => {
      const labelLines = pdf.splitTextToSize(line.label, labelMaxW) as string[];
      pdf.text(labelLines[0] ?? "", marginX, y);
      pdf.text(fitTextToWidth(pdf, qtyTexts[i] ?? "", qtyColW - 1), qtyX, y, {
        align: "right",
      });
      pdf.text(fitTextToWidth(pdf, amtTexts[i] ?? "", amtColW - 1), amtX, y, {
        align: "right",
      });
      y += bodyFont * 0.62;
      for (let j = 1; j < labelLines.length; j++) {
        pdf.text(labelLines[j] ?? "", marginX, y);
        y += bodyFont * 0.62;
      }
    });
    y += 1;
    pdf.setLineDashPattern([1, 0.8], 0);
    pdf.line(marginX, y, width - marginX, y);
    pdf.setLineDashPattern([], 0);
    y += 4;

    const grand = doc.totals.find((t) => t.strong);
    for (const t of doc.totals) {
      const bold = t === grand;
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      pdf.setFontSize(bold ? bodyFont * 1.15 : bodyFont);
      const value = fitTextToWidth(pdf, t.value, contentW * 0.48);
      const valueW = pdf.getTextWidth(value);
      pdf.text(
        fitTextToWidth(
          pdf,
          t.label.toUpperCase(),
          Math.max(4, contentW - valueW - 2),
        ),
        marginX,
        y,
      );
      pdf.text(value, width - marginX, y, { align: "right" });
      y += (bold ? bodyFont * 1.15 : bodyFont) * 0.65;
      if (bold) {
        pdf.setDrawColor(...RULE);
        pdf.line(marginX, y - 1, width - marginX, y - 1);
      }
    }
    y += 2;

    if (doc.note) {
      pdf.setFont("helvetica", "italic");
      pdf.setFontSize(smallFont);
      const noteLines = pdf.splitTextToSize(
        `Note: ${doc.note}`,
        contentW,
      ) as string[];
      for (const line of noteLines) {
        pdf.text(line, marginX, y);
        y += smallFont * 0.6;
      }
      y += 2;
    }

    // Payment / QR panel — only when a UPI ID is configured. Same shared
    // drawUpiPanel block the A4/A5/80mm layouts use (see renderBoxed above),
    // in its condensed "slim" variant.
    if (s.upiId.trim()) {
      const balanceRow = doc.totals.find((t) => t.label === "Balance due");
      const statusVal = (
        doc.totals.find((t) => t.label === "Status")?.value || ""
      ).toUpperCase();
      const panelH = drawUpiPanel(pdf, {
        x: marginX,
        y,
        width: contentW,
        upiId: s.upiId,
        payeeName: s.shopName,
        reference: doc.docNo,
        balanceText: balanceRow?.value ?? null,
        status: statusVal,
        scale,
        variant: "slim",
        apps: s.upiApps,
        navy: NAVY,
        gold: GOLD,
        fill: LIGHT_FILL,
        green: GREEN,
      });
      y += panelH + 2;
    }

    pdf.setLineDashPattern([1, 0.8], 0);
    pdf.setDrawColor(...RULE);
    pdf.line(marginX, y, width - marginX, y);
    pdf.setLineDashPattern([], 0);
    y += 4;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(bodyFont);
    pdf.text("THANK YOU!", width / 2, y, { align: "center" });
    y += bodyFont * 0.6;
    if (s.footerLine) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(smallFont);
      pdf.text(fitTextToWidth(pdf, s.footerLine, contentW), width / 2, y, {
        align: "center",
      });
      y += smallFont * 0.6;
    }
    if (s.shopPhone && s.showPhone) {
      pdf.text(fitTextToWidth(pdf, s.shopPhone, contentW), width / 2, y, {
        align: "center",
      });
      y += smallFont * 0.6;
    }

    const cutFeedMm = Math.max(0, Math.min(40, s.cutFeedMm || 0));
    if (cutFeedMm) y += cutFeedMm;
    return y;
  };

  const SCRATCH = 3000;
  const scratch = new jsPDF({ unit: "mm", format: [width, SCRATCH] });
  const measured = renderBody(scratch, SCRATCH);
  const height = measured + 2;
  const pdf = new jsPDF({ unit: "mm", format: [width, height] });
  renderBody(pdf, height);
  return pdf;
}
