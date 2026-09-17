import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import {
  PAYMENT_BRAND_LOGOS,
  UPI_MARK_LOGO,
  type PaymentBrandId,
} from "./payment-brand-assets";

/**
 * The single "Scan & Pay" payment panel shared by every bill format —
 * A4/A5 invoices, the 80mm roll (colour and thermal B&W) and the 58/50mm POS
 * slip all draw it from here, so the QR payload, the quiet zone, the wording
 * and the UPI app strip can never drift apart between formats.
 *
 * The QR is a *static* UPI QR (no `am` parameter): the payer types the amount
 * themselves, which is what turf advances, part payments and running dues
 * need. Payload follows the NPCI deep-link format (`pa`/`pn`/`cu`/`tn`) that
 * GPay, PhonePe, Paytm and BHIM all accept.
 */

export const UPI_APPS = [
  { id: "gpay", name: "GPay", color: [66, 133, 244] as RGB, brand: "gpay" },
  {
    id: "phonepe",
    name: "PhonePe",
    color: [95, 37, 159] as RGB,
    brand: "phonepe",
  },
  { id: "paytm", name: "Paytm", color: [0, 150, 214] as RGB, brand: "paytm" },
  { id: "bhim", name: "BHIM", color: [242, 101, 34] as RGB, brand: "bhim" },
] as const;

export type UpiAppId = (typeof UPI_APPS)[number]["id"];
export const UPI_APP_IDS: UpiAppId[] = UPI_APPS.map((a) => a.id);

/** Shown on a receipt when the shop hasn't picked a custom set — the two
 * apps almost every customer in India already has installed. */
export const DEFAULT_UPI_APPS: UpiAppId[] = ["gpay", "phonepe"];

/** Resolves saved app ids to their chip definitions, preserving the order
 * the shop picked and silently dropping anything unrecognised. Falls back
 * to the default pair when the resulting list would otherwise be empty
 * (nothing selected, or a corrupted/blank setting). */
function resolveApps(ids: UpiAppId[] | undefined): (typeof UPI_APPS)[number][] {
  const wanted = ids && ids.length ? ids : DEFAULT_UPI_APPS;
  const resolved = wanted
    .map((id) => UPI_APPS.find((a) => a.id === id))
    .filter((a): a is (typeof UPI_APPS)[number] => !!a);
  return resolved.length
    ? resolved
    : UPI_APPS.filter((a) => DEFAULT_UPI_APPS.includes(a.id));
}

export type RGB = [number, number, number];

/** Static UPI deep link — deliberately amount-less (see file header). `tn`
 * is capped at the 50-character note limit UPI apps enforce. */
export function upiUri(opts: {
  upiId: string;
  payeeName?: string;
  note?: string;
}): string {
  const params = new URLSearchParams();
  params.set("pa", opts.upiId.trim());
  if (opts.payeeName?.trim())
    params.set("pn", opts.payeeName.trim().slice(0, 50));
  params.set("cu", "INR");
  if (opts.note?.trim()) params.set("tn", opts.note.trim().slice(0, 50));
  return `upi://pay?${params.toString()}`;
}

/** Dark/light module grid, built synchronously so the QR can be drawn as
 * plain jsPDF rects (vector, crisp at any size) instead of a rasterised PNG.
 * Level Q survives a folded, smudged or thermal-faded print far better than
 * the level M this used to use. */
export function qrGrid(text: string): boolean[][] | null {
  try {
    const qr = QRCode.create(text, { errorCorrectionLevel: "Q" });
    const size = qr.modules.size;
    const grid: boolean[][] = [];
    for (let r = 0; r < size; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < size; c++) row.push(!!qr.modules.get(r, c));
      grid.push(row);
    }
    return grid;
  } catch {
    return null;
  }
}

/**
 * Draws a QR inside a white tile of exactly `sizeMm`, keeping the 4-module
 * quiet zone the spec requires — scanners lose lock without it, which is the
 * usual reason a printed bill's QR "doesn't work".
 */
export function drawQr(
  pdf: jsPDF,
  x: number,
  y: number,
  sizeMm: number,
  text: string,
  dark: RGB = [0, 0, 0],
) {
  const grid = qrGrid(text);
  if (!grid) return;
  const n = grid.length;
  const quiet = 4;
  const mod = sizeMm / (n + quiet * 2);
  const originX = x + mod * quiet;
  const originY = y + mod * quiet;
  pdf.setFillColor(255, 255, 255);
  pdf.rect(x, y, sizeMm, sizeMm, "F");
  pdf.setFillColor(...dark);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      // +0.02mm bleed closes the hairline seams jsPDF leaves between
      // adjacent fills at small module sizes.
      if (grid[r]?.[c])
        pdf.rect(
          originX + c * mod,
          originY + r * mod,
          mod + 0.02,
          mod + 0.02,
          "F",
        );
    }
  }
}

/**
 * Draws the official UPI wordmark as the embedded reference logo image
 * instead of the hand-drawn vector mark, scaled to fit *inside* the navy
 * header strip — never taller than `maxH` — so it can't spill over the top
 * or bottom edge of the header the way an unscaled image would. Returns the
 * rendered width so the caller can right-align it.
 */
function drawUpiMarkImage(
  pdf: jsPDF,
  rightX: number,
  centerY: number,
  maxH: number,
): number {
  const h = maxH;
  const w = h * UPI_MARK_LOGO.aspect;
  const x = rightX - w;
  const y = centerY - h / 2;
  pdf.addImage(UPI_MARK_LOGO.dataUrl, "PNG", x, y, w, h);
  return w;
}

function appStripWidth(
  apps: (typeof UPI_APPS)[number][],
  logoH: number,
  padX: number,
  gap: number,
) {
  return apps.reduce(
    (w, a) =>
      w +
      logoH * PAYMENT_BRAND_LOGOS[a.brand as PaymentBrandId].aspect +
      padX * 2 +
      gap,
    -gap,
  );
}

/** Packs chips onto as few rows as fit within `maxRowWidth`, greedily
 * adding to the current row and only starting a new one when the next chip
 * would overflow it — so 2-3 apps still sit on one line, and only a full
 * set of 4 (on a narrow enough card) wraps onto a second. */
function wrapAppRows(
  apps: (typeof UPI_APPS)[number][],
  logoH: number,
  padX: number,
  gap: number,
  maxRowWidth: number,
): (typeof UPI_APPS)[number][][] {
  const rows: (typeof UPI_APPS)[number][][] = [[]];
  for (const app of apps) {
    const row = rows[rows.length - 1] ?? [];
    const trial = [...row, app];
    if (row.length && appStripWidth(trial, logoH, padX, gap) > maxRowWidth) {
      rows.push([app]);
    } else {
      rows[rows.length - 1] = trial;
    }
  }
  return rows;
}

function appStripChipMetrics(fontSize: number, mono: boolean) {
  const padX = mono ? 0.8 : 1;
  const gap = 1.2;
  const rowGap = 1;
  const logoH = Math.max(2.8, fontSize * 0.62);
  const padY = 0.45;
  const rowH = logoH + padY * 2;
  return { padX, gap, rowGap, logoH, padY, rowH };
}

/** Height the app-chip strip will consume for a given width budget, without
 * drawing anything — lets the panel-height math (and the A5 overflow check)
 * reserve the right amount of room even when the shop's picked apps need to
 * wrap onto a second row. */
export function estimateAppStripHeight(
  apps: (typeof UPI_APPS)[number][],
  fontSize: number,
  mono: boolean,
  maxRowWidth: number,
): number {
  const { padX, gap, rowGap, logoH, rowH } = appStripChipMetrics(
    fontSize,
    mono,
  );
  const rows = wrapAppRows(apps, logoH, padX, gap, maxRowWidth);
  return rows.length * rowH + (rows.length - 1) * rowGap;
}

/**
 * Row of official UPI-app wordmarks, limited to whichever apps the shop
 * picked in Settings. The PNGs are embedded in the bundle rather than loaded
 * from a URL, so exported invoices keep their brand marks offline and the
 * synchronous jsPDF renderer can place them reliably.
 *
 * Wraps onto a second row — instead of running past the edge of the card,
 * which is what a 4-app selection used to do — whenever the full strip
 * doesn't fit the width budget in `bounds`. Each row is centred
 * independently and clamped inside `bounds`, so it stays on the card even
 * when `centerX` (usually the QR's centre) sits off to one side rather than
 * at the panel's true centre.
 */
function drawAppStrip(
  pdf: jsPDF,
  apps: (typeof UPI_APPS)[number][],
  centerX: number,
  y: number,
  fontSize: number,
  mono: boolean,
  bounds?: { left: number; right: number },
): number {
  const { padX, gap, rowGap, logoH, padY, rowH } = appStripChipMetrics(
    fontSize,
    mono,
  );
  const left = bounds?.left ?? -1e6;
  const right = bounds?.right ?? 1e6;
  const maxRowWidth = Math.max(logoH * 2, right - left);
  const rows = wrapAppRows(apps, logoH, padX, gap, maxRowWidth);

  let rowY = y;
  for (const row of rows) {
    const rowTotal = appStripWidth(row, logoH, padX, gap);
    let x = centerX - rowTotal / 2;
    x = Math.min(Math.max(x, left), right - rowTotal);
    for (const app of row) {
      const logo = PAYMENT_BRAND_LOGOS[app.brand as PaymentBrandId];
      const logoW = logoH * logo.aspect;
      const w = logoW + padX * 2;
      pdf.setFillColor(255, 255, 255);
      pdf.setDrawColor(mono ? 90 : 220, mono ? 90 : 222, mono ? 90 : 228);
      pdf.setLineWidth(0.15);
      pdf.roundedRect(x, rowY, w, rowH, 0.7, 0.7, "FD");
      pdf.addImage(logo.dataUrl, "PNG", x + padX, rowY + padY, logoW, logoH);
      x += w + gap;
    }
    rowY += rowH + rowGap;
  }
  return rowY - y - rowGap;
}

export type UpiPanelOpts = {
  x: number;
  y: number;
  width: number;
  upiId: string;
  payeeName: string;
  /** Bill number, printed as the payment reference and put in the QR note. */
  reference: string;
  /** Pre-formatted balance, e.g. "₹ 2,520.00". Null/absent = nothing due. */
  balanceText?: string | null;
  /** PAID / UNPAID / PARTIAL, straight off the bill's totals. */
  status?: string;
  scale: number;
  /** wide = A4/A5 two-column card, roll = 80mm centred card,
   *  slim = 58/50mm dashed POS block. */
  variant: "wide" | "roll" | "slim";
  /** Thermal black-and-white output: no colour fills anywhere. */
  mono?: boolean;
  /** Which UPI app chips to show, in order. Defaults to GPay + PhonePe. */
  apps?: UpiAppId[];
  navy: RGB;
  gold: RGB;
  fill: RGB;
  green: RGB;
  /** A4 gets a bigger QR than A5; roll/slim size themselves. */
  qrSize?: number | undefined;
};

/**
 * The wide/roll panel's sizing math, in one place. `estimateUpiPanelHeight`
 * (a dry-run size check for the A4/A5 QR-shrink loop) and `drawUpiPanel`
 * (the real draw) used to each keep their own copy of this formula with a
 * "keep in sync" comment holding them together by hand — the kind of thing
 * that quietly drifts the next time either one changes. Both now call this
 * instead, so there is exactly one formula to get right. jsPDF has no
 * dry-run/measure-only mode, which is why this only computes numbers and
 * never touches `pdf`. */
function panelMetrics(o: {
  width: number;
  scale: number;
  variant: "wide" | "roll";
  qrSize?: number | undefined;
  hasBalance: boolean;
  paid: boolean;
  apps: (typeof UPI_APPS)[number][];
}) {
  const wide = o.variant === "wide";
  const scale = o.scale || 1;
  const qrSize = o.qrSize ?? (wide ? 30 : 26);
  const pad = wide ? 4 : 3;
  const headerH = (wide ? 6.5 : 5.5) * scale;
  const titleFont = (wide ? 8.5 : 7) * scale;
  const bodyFont = (wide ? 8 : 6.5) * scale;
  const smallFont = (wide ? 6.8 : 5.8) * scale;
  const chipFont = (wide ? 5.6 : 5) * scale;
  // Width budget the chip strip actually gets to lay out in (full card
  // minus the side padding) — used to size the reserved height, so a
  // 4-app selection that wraps onto a second row still gets the room it
  // needs instead of the panel border cutting it off.
  const chipStripH = estimateAppStripHeight(
    o.apps,
    chipFont,
    false,
    o.width - pad * 2,
  );
  const qrBlockH = qrSize + 2 + chipStripH + 1.5 + smallFont * 0.5;
  const detailRows = 3 + (o.hasBalance || o.paid ? 1 : 0);
  const detailsH = detailRows * bodyFont * 0.62 + 2;
  const bodyH = wide ? Math.max(qrBlockH, detailsH) : qrBlockH + detailsH + 2;
  const panelH = headerH + pad + bodyH + pad;
  return {
    wide,
    qrSize,
    pad,
    headerH,
    titleFont,
    bodyFont,
    smallFont,
    chipFont,
    panelH,
  };
}

/** Mirrors the wide/roll height formula in drawUpiPanel below without
 * drawing anything, so a caller on a fixed-height sheet (A4/A5) can check
 * whether the panel fits in the room left above the footer *before*
 * drawing it, and shrink qrSize if it doesn't. */
export function estimateUpiPanelHeight(o: {
  width: number;
  scale: number;
  variant: "wide" | "roll";
  qrSize?: number | undefined;
  hasBalance: boolean;
  paid: boolean;
  apps?: UpiAppId[];
}): number {
  return panelMetrics({ ...o, apps: resolveApps(o.apps) }).panelH;
}

/** Draws the panel at (x, y) and returns the height consumed, so callers can
 * simply advance their own cursor by the return value. */
export function drawUpiPanel(pdf: jsPDF, o: UpiPanelOpts): number {
  const upiId = o.upiId.trim();
  if (!upiId) return 0;
  const mono = !!o.mono;
  const scale = o.scale || 1;
  const uri = upiUri({
    upiId,
    payeeName: o.payeeName,
    note: o.reference ? `Bill ${o.reference}` : "",
  });
  const paid = (o.status || "").toUpperCase() === "PAID";
  const dark: RGB = mono ? [0, 0, 0] : [10, 10, 10];
  const apps = resolveApps(o.apps);

  if (o.variant === "slim") return drawSlim(pdf, o, uri, upiId, scale, apps);

  const wide = o.variant === "wide";
  const {
    qrSize,
    pad,
    headerH,
    titleFont,
    bodyFont,
    smallFont,
    chipFont,
    panelH,
  } = panelMetrics({
    scale,
    variant: o.variant,
    qrSize: o.qrSize,
    hasBalance: !!o.balanceText,
    paid,
    width: o.width,
    apps,
  });

  // Card + navy header strip with the gold hairline.
  pdf.setFillColor(255, 255, 255);
  pdf.setDrawColor(mono ? 120 : 190, mono ? 120 : 195, mono ? 120 : 205);
  pdf.setLineWidth(0.2);
  pdf.roundedRect(o.x, o.y, o.width, panelH, 2, 2, "FD");
  pdf.setFillColor(...o.navy);
  pdf.rect(o.x + 0.6, o.y + 0.6, o.width - 1.2, headerH, "F");
  if (!mono) {
    pdf.setFillColor(...o.gold);
    pdf.rect(o.x + 0.6, o.y + 0.6 + headerH - 0.7, o.width - 1.2, 0.7, "F");
  }
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(titleFont);
  pdf.setTextColor(255, 255, 255);
  pdf.text("SCAN & PAY", o.x + pad, o.y + headerH * 0.72);
  if (mono) {
    // Thermal B&W can't print the tricolour arrow — just the plain white
    // "UPI" wordmark, right-aligned like the colour header.
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(titleFont);
    pdf.setTextColor(255, 255, 255);
    pdf.text("UPI", o.x + o.width - pad, o.y + headerH * 0.72, {
      align: "right",
    });
  } else {
    // Logo height is capped to the header strip's own inner height (minus
    // the gold hairline and a touch of breathing room top/bottom) so it is
    // always contained inside the navy strip, never overflowing above or
    // below it regardless of the panel's scale.
    const markH = Math.min(headerH - 1.6, titleFont * 1.15);
    drawUpiMarkImage(pdf, o.x + o.width - pad, o.y + 0.6 + headerH / 2, markH);
  }

  const topY = o.y + headerH + pad;
  const qrX = wide
    ? o.x + o.width - pad - qrSize
    : o.x + (o.width - qrSize) / 2;
  const qrY = topY;

  // QR tile with a thin frame so it reads as a scan target.
  pdf.setDrawColor(mono ? 90 : 170, mono ? 90 : 175, mono ? 90 : 185);
  pdf.setLineWidth(0.25);
  pdf.rect(qrX - 0.8, qrY - 0.8, qrSize + 1.6, qrSize + 1.6, "D");
  drawQr(pdf, qrX, qrY, qrSize, uri, dark);

  const chipStripH = drawAppStrip(
    pdf,
    apps,
    qrX + qrSize / 2,
    qrY + qrSize + 2,
    chipFont,
    mono,
    {
      left: o.x + pad,
      right: o.x + o.width - pad,
    },
  );
  const underY = qrY + qrSize + 2 + chipStripH + 1.5 + smallFont * 0.5;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(smallFont);
  pdf.setTextColor(110, 110, 110);
  pdf.text(
    "Scan with any UPI app",
    qrX + qrSize / 2,
    underY - smallFont * 0.12,
    {
      align: "center",
    },
  );

  // Details column: to the left of the QR on A4/A5, beneath it on the roll.
  const detX = o.x + pad;
  const detW = wide ? o.width - pad * 3 - qrSize : o.width - pad * 2;
  let dy = (wide ? topY : underY + 3) + bodyFont * 0.55;
  const line = (label: string, value: string, strong = false, color?: RGB) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(bodyFont * (strong ? 1.05 : 1));
    pdf.setTextColor(...(mono ? ([60, 60, 60] as RGB) : o.navy));
    pdf.text(label, detX, dy);
    const lw = pdf.getTextWidth(label);
    pdf.setFont("helvetica", strong ? "bold" : "normal");
    pdf.setTextColor(...(color ?? ([40, 40, 40] as RGB)));
    // Long values (a UPI ID like "shopname@okhdfcbank" is often wider than
    // the column) used to be passed to text() with a maxWidth option —
    // jsPDF then silently wraps them onto extra lines, but `dy` only ever
    // advanced by one line, so a wrapped 2nd line landed right on top of
    // the next label/value row. Measure the wrap ourselves so dy accounts
    // for however many lines the value actually took.
    const valueMaxW = Math.max(10, detW - lw - 2);
    const valueLines = pdf.splitTextToSize(`  ${value}`, valueMaxW) as string[];
    valueLines.forEach((vLine, vi) => {
      pdf.text(vLine, detX + lw, dy + vi * bodyFont * 0.62);
    });
    dy += bodyFont * 0.62 * valueLines.length;
  };
  line("Pay to", o.payeeName || upiId);
  line("UPI ID", upiId);
  if (o.reference) line("Ref", o.reference);
  if (paid) {
    const label = "PAID";
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(bodyFont);
    const w = pdf.getTextWidth(label) + 4;
    if (mono) {
      pdf.setDrawColor(40, 40, 40);
      pdf.roundedRect(
        detX,
        dy - bodyFont * 0.36,
        w,
        bodyFont * 0.52,
        1,
        1,
        "D",
      );
      pdf.setTextColor(20, 20, 20);
    } else {
      pdf.setFillColor(...o.green);
      pdf.roundedRect(
        detX,
        dy - bodyFont * 0.36,
        w,
        bodyFont * 0.52,
        1,
        1,
        "F",
      );
      pdf.setTextColor(255, 255, 255);
    }
    pdf.text(label, detX + w / 2, dy, { align: "center" });
  } else if (o.balanceText) {
    line(
      "Balance due",
      o.balanceText,
      true,
      mono ? [20, 20, 20] : [150, 90, 10],
    );
  }

  return panelH;
}

/** 58/50mm POS slip: no card frame (thermal slips are dashed-rule affairs),
 * just a centred block that matches the rest of the condensed layout. */
function drawSlim(
  pdf: jsPDF,
  o: UpiPanelOpts,
  uri: string,
  upiId: string,
  scale: number,
  apps: (typeof UPI_APPS)[number][],
): number {
  const centerX = o.x + o.width / 2;
  const titleFont = 7 * scale;
  const smallFont = 5.6 * scale;
  const qrSize = Math.min(o.width - 6, 30);
  const paid = (o.status || "").toUpperCase() === "PAID";
  let y = o.y;

  pdf.setDrawColor(150, 150, 150);
  pdf.setLineDashPattern([1, 0.8], 0);
  pdf.line(o.x, y, o.x + o.width, y);
  pdf.setLineDashPattern([], 0);
  y += 4;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(titleFont);
  pdf.setTextColor(20, 20, 20);
  pdf.text("SCAN & PAY  ·  UPI", centerX, y, { align: "center" });
  y += 2;

  pdf.setDrawColor(90, 90, 90);
  pdf.setLineWidth(0.25);
  pdf.rect(
    centerX - qrSize / 2 - 0.8,
    y - 0.8,
    qrSize + 1.6,
    qrSize + 1.6,
    "D",
  );
  drawQr(pdf, centerX - qrSize / 2, y, qrSize, uri, [0, 0, 0]);
  y += qrSize + 3;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(smallFont);
  pdf.setTextColor(20, 20, 20);
  pdf.text(upiId, centerX, y, { align: "center" });
  y += smallFont * 0.62;
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(70, 70, 70);
  // splitTextToSize wraps onto a second centered line instead of running
  // the full "GPay | PhonePe | Paytm | BHIM" list past the slip's edge
  // when all four apps are picked on a narrow 50/58mm format.
  const appLines = pdf.splitTextToSize(
    apps.map((a) => a.name).join(" | "),
    o.width - 4,
  ) as string[];
  appLines.forEach((appLine) => {
    pdf.text(appLine, centerX, y, { align: "center" });
    y += smallFont * 0.62;
  });

  // Paid / balance-due mark, same information the wide and roll variants
  // carry — a fully paid slip shouldn't still invite the customer to pay,
  // and a partial one should show what's left before it asks them to open
  // their UPI app.
  if (paid) {
    const label = "PAID";
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(smallFont);
    const w = pdf.getTextWidth(label) + 4;
    pdf.setDrawColor(40, 40, 40);
    pdf.setLineWidth(0.15);
    pdf.roundedRect(
      centerX - w / 2,
      y - smallFont * 0.36,
      w,
      smallFont * 0.52,
      1,
      1,
      "D",
    );
    pdf.setTextColor(20, 20, 20);
    pdf.text(label, centerX, y, { align: "center" });
    y += smallFont * 0.62;
  } else {
    if (o.balanceText) {
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(150, 90, 10);
      pdf.text(`Balance due  ${o.balanceText}`, centerX, y, {
        align: "center",
      });
      y += smallFont * 0.62;
    }
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(70, 70, 70);
    pdf.text("Enter amount in your UPI app", centerX, y, { align: "center" });
    y += smallFont * 0.62;
  }
  y += 2;

  return y - o.y;
}
