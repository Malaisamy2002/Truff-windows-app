import { rupees } from "./money";
import type { Borders, DataBarRuleType, Worksheet } from "exceljs";

/**
 * Brand palette lifted from the app's CSS custom properties (styles.css,
 * light theme) so the exported Dashboard sheet reads as the same product,
 * not a generic spreadsheet. ARGB, no leading "#".
 */
const COLOR = {
  primary: "FF3B5FCC",
  primaryDark: "FF23408F",
  onPrimary: "FFFFFFFF",
  success: "FF1E9E70",
  destructive: "FFD8483F",
  headerBg: "FFEFF3FC",
  cardBg: "FFF7F9FE",
  border: "FFD8E0F2",
  muted: "FF6B7690",
  text: "FF1B2436",
} as const;

const thinBorder: Partial<Borders> = {
  top: { style: "thin", color: { argb: COLOR.border } },
  left: { style: "thin", color: { argb: COLOR.border } },
  bottom: { style: "thin", color: { argb: COLOR.border } },
  right: { style: "thin", color: { argb: COLOR.border } },
};

export type DashboardKpi = {
  label: string;
  value: number;
  previous: number;
  change: number | null;
  /** true when a rise in this metric is bad news (e.g. Expenses). */
  invert?: boolean;
  isCurrency?: boolean;
};

export type DashboardPnlRow = {
  month: string;
  Revenue: number;
  Expenses: number;
  Profit: number;
};

export type DashboardData = {
  shopName: string;
  periodLabel: string;
  currencySymbol: string;
  kpis: DashboardKpi[];
  collectionRatePct: number;
  topExpense: { name: string; value: number } | null;
  avgBookingValue: number;
  pnl: DashboardPnlRow[];
};

const fmtMoney = (symbol: string, v: number) =>
  `${symbol} ${rupees(v).toLocaleString("en-IN")}`;

const fmtDelta = (change: number | null, invert: boolean) => {
  if (change === null) return { text: "n/a", good: null as boolean | null };
  const good = invert ? change <= 0 : change >= 0;
  const sign = change > 0 ? "+" : "";
  return { text: `${sign}${change.toFixed(1)}% vs last month`, good };
};

/** Writes one KPI card into a 3-row x 3-col block starting at (row, col). */
function writeKpiCard(
  ws: Worksheet,
  row: number,
  col: number,
  kpi: DashboardKpi,
  currencySymbol: string,
) {
  const valueText =
    kpi.isCurrency === false
      ? `${kpi.value.toFixed(1)}%`
      : fmtMoney(currencySymbol, kpi.value);
  const delta = fmtDelta(kpi.change, kpi.invert ?? false);

  // Label row
  ws.mergeCells(row, col, row, col + 2);
  const labelCell = ws.getCell(row, col);
  labelCell.value = kpi.label.toUpperCase();
  labelCell.font = { size: 9, bold: true, color: { argb: COLOR.muted } };
  labelCell.alignment = { vertical: "middle" };

  // Value row
  ws.mergeCells(row + 1, col, row + 1, col + 2);
  const valueCell = ws.getCell(row + 1, col);
  valueCell.value = valueText;
  valueCell.font = { size: 16, bold: true, color: { argb: COLOR.text } };
  valueCell.alignment = { vertical: "middle" };

  // Delta row
  ws.mergeCells(row + 2, col, row + 2, col + 2);
  const deltaCell = ws.getCell(row + 2, col);
  deltaCell.value = delta.text;
  deltaCell.font = {
    size: 9,
    bold: true,
    color: {
      argb:
        delta.good === null
          ? COLOR.muted
          : delta.good
            ? COLOR.success
            : COLOR.destructive,
    },
  };
  deltaCell.alignment = { vertical: "middle" };

  // Card background + border across the whole 3x3 block, and a left accent
  // strip on the first column echoing the app's `HeroStat` tone-ring.
  for (let r = row; r < row + 3; r++) {
    for (let c = col; c < col + 3; c++) {
      const cell = ws.getCell(r, c);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLOR.cardBg },
      };
      cell.border = thinBorder;
    }
    ws.getCell(r, col).border = {
      ...thinBorder,
      left: { style: "medium", color: { argb: COLOR.primary } },
    };
  }
}

/**
 * Builds the full Dashboard sheet in place. Meant to be passed as a
 * `build` callback to `exportWorkbook`'s sheet spec.
 */
export function buildDashboardSheet(ws: Worksheet, data: DashboardData) {
  const CARD_W = 3; // columns per KPI card
  const GAP = 1; // gutter column between cards
  const CARDS_PER_ROW = 3;
  const totalCols = CARDS_PER_ROW * CARD_W + (CARDS_PER_ROW - 1) * GAP;

  ws.columns = Array.from({ length: totalCols }, () => ({ width: 12 }));
  ws.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.3,
      right: 0.3,
      top: 0.4,
      bottom: 0.4,
      header: 0,
      footer: 0,
    },
  };
  ws.views = [{ showGridLines: false }];

  // --- Title band ---
  ws.mergeCells(1, 1, 1, totalCols);
  const title = ws.getCell(1, 1);
  title.value = data.shopName;
  title.font = { size: 18, bold: true, color: { argb: COLOR.onPrimary } };
  title.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 30;
  for (let c = 1; c <= totalCols; c++) {
    ws.getCell(1, c).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.primaryDark },
    };
  }

  ws.mergeCells(2, 1, 2, totalCols);
  const subtitle = ws.getCell(2, 1);
  subtitle.value = `Dashboard — ${data.periodLabel}`;
  subtitle.font = { size: 11, color: { argb: COLOR.onPrimary } };
  ws.getRow(2).height = 20;
  for (let c = 1; c <= totalCols; c++) {
    ws.getCell(2, c).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.primary },
    };
  }

  // --- KPI grid (2 rows of 3 cards, each card 3 rows tall) ---
  let row = 4;
  for (let i = 0; i < data.kpis.length; i += CARDS_PER_ROW) {
    const rowKpis = data.kpis.slice(i, i + CARDS_PER_ROW);
    rowKpis.forEach((kpi, idx) => {
      const col = 1 + idx * (CARD_W + GAP);
      writeKpiCard(ws, row, col, kpi, data.currencySymbol);
    });
    row += 4; // 3 rows of card + 1 row gap
  }

  // --- Quick insights strip ---
  row += 1;
  ws.mergeCells(row, 1, row, totalCols);
  const insightsHeader = ws.getCell(row, 1);
  insightsHeader.value = "AT A GLANCE";
  insightsHeader.font = { size: 9, bold: true, color: { argb: COLOR.muted } };
  row += 1;

  ws.getCell(row, 1).value = "Collection rate";
  ws.getCell(row, 1).font = { bold: true, color: { argb: COLOR.text } };
  ws.getCell(row, 1 + CARD_W).value = `${data.collectionRatePct.toFixed(1)}%`;
  row += 1;

  ws.getCell(row, 1).value = "Top expense category";
  ws.getCell(row, 1).font = { bold: true, color: { argb: COLOR.text } };
  ws.getCell(row, 1 + CARD_W).value = data.topExpense
    ? `${data.topExpense.name} (${fmtMoney(data.currencySymbol, data.topExpense.value)})`
    : "—";
  row += 1;

  ws.getCell(row, 1).value = "Avg. booking value";
  ws.getCell(row, 1).font = { bold: true, color: { argb: COLOR.text } };
  ws.getCell(row, 1 + CARD_W).value = fmtMoney(
    data.currencySymbol,
    data.avgBookingValue,
  );
  row += 2;

  // --- 6-month P&L mini table with data bars ---
  ws.mergeCells(row, 1, row, totalCols);
  const pnlHeader = ws.getCell(row, 1);
  pnlHeader.value = "PROFIT & LOSS — LAST 6 MONTHS";
  pnlHeader.font = { size: 9, bold: true, color: { argb: COLOR.muted } };
  row += 1;

  const headerCells = ["Month", "Revenue (incl. tax)", "Expenses", "Profit"];
  headerCells.forEach((h, idx) => {
    const cell = ws.getCell(row, 1 + idx);
    cell.value = h;
    cell.font = { bold: true, color: { argb: COLOR.text } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.headerBg },
    };
    cell.border = thinBorder;
  });
  row += 1;

  const dataStartRow = row;
  for (const r of data.pnl) {
    ws.getCell(row, 1).value = r.month;
    ws.getCell(row, 2).value = r.Revenue;
    ws.getCell(row, 3).value = r.Expenses;
    ws.getCell(row, 4).value = r.Profit;
    for (let c = 1; c <= 4; c++) {
      const cell = ws.getCell(row, c);
      cell.border = thinBorder;
      if (c > 1) cell.numFmt = "#,##0";
    }
    row += 1;
  }
  const dataEndRow = row - 1;

  if (dataEndRow >= dataStartRow) {
    ws.addConditionalFormatting({
      ref: `B${dataStartRow}:B${dataEndRow}`,
      rules: [
        {
          type: "dataBar",
          priority: 1,
          gradient: false,
          border: false,
          cfvo: [{ type: "min" }, { type: "max" }],
          color: { argb: COLOR.primary },
        } as DataBarRuleType,
      ],
    });
    ws.addConditionalFormatting({
      ref: `D${dataStartRow}:D${dataEndRow}`,
      rules: [
        {
          type: "dataBar",
          priority: 1,
          gradient: false,
          border: false,
          negativeBarColorSameAsPositive: false,
          cfvo: [{ type: "min" }, { type: "max" }],
          color: { argb: COLOR.success },
        } as DataBarRuleType,
      ],
    });
  }

  ws.getColumn(1).width = 16;
  for (let c = 2; c <= totalCols; c++) ws.getColumn(c).width = 12;
}
