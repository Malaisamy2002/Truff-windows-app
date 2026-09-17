import { describe, expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";

import {
  DEFAULT_PRINT_SETTINGS,
  type PaperId,
  type PrintSettings,
} from "./print";
import type { ReceiptDoc } from "./receipt";
import { buildPremiumReceiptPdf } from "./receipt-premium";
import { drawUpiPanel, estimateUpiPanelHeight, upiUri } from "./receipt-upi";

/**
 * Same text-capture harness as receipt-layout.test.ts (jsPDF assigns `text`
 * as an own instance property, not on the prototype, so a prototype patch
 * never sees these calls). Kept as its own copy rather than imported from
 * that file so this file's `vi.mock("jspdf", ...)` — which every test here
 * needs active from the start — doesn't depend on load order between the
 * two test files.
 */
type TextCall = {
  text: string;
  x: number;
  width: number;
  align: string | undefined;
  pageWidth: number;
};
let activeCapture: TextCall[] | null = null;

vi.mock("jspdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jspdf")>();
  function PatchedJsPDF(
    this: unknown,
    ...args: ConstructorParameters<typeof actual.jsPDF>
  ) {
    const instance = new actual.jsPDF(...args);
    const originalText = instance.text.bind(instance);
    instance.text = (
      text: string | string[],
      x: number,
      y: number,
      options?: import("jspdf").TextOptions,
    ) => {
      if (activeCapture && typeof text === "string") {
        activeCapture.push({
          text,
          x,
          width: instance.getTextWidth(text),
          align: options?.align,
          pageWidth: instance.internal.pageSize.getWidth(),
        });
      }
      return originalText(text, x, y, options);
    };
    return instance;
  }
  return { ...actual, jsPDF: PatchedJsPDF };
});

function captureTextCalls(run: () => unknown): TextCall[] {
  const calls: TextCall[] = [];
  activeCapture = calls;
  try {
    run();
  } finally {
    activeCapture = null;
  }
  return calls;
}

const FONT_SCALES = [0.9, 1, 1.15, 1.3] as const;
// Every paper id buildPremiumReceiptPdf actually has a dedicated layout for.
const PREMIUM_PAPERS: PaperId[] = ["a4", "a5", "80mm", "58mm", "50mm"];
// Everything else falls back to the classic renderer (buildReceiptPdf, not
// buildPremiumReceiptPdf itself) — buildPremiumReceiptPdf returns null.
const NON_PREMIUM_PAPERS: PaperId[] = ["letter", "76mm", "custom"];

const premiumSettings = (
  overrides: Partial<PrintSettings> = {},
): PrintSettings => ({
  ...DEFAULT_PRINT_SETTINGS,
  templateStyle: "premium",
  logo: null,
  banner: null,
  background: null,
  rollHeader: null,
  ...overrides,
});

const PATHOLOGICAL_DOC: ReceiptDoc = {
  kind: "Bill",
  docNo: "INV-20260101-0001",
  dateText: "01-01-2026",
  customer: "A Customer With A Genuinely Long Full Name That Keeps Going",
  phone: "9876543210",
  email: "a.customer.with.a.very.long.email.address@example.com",
  lines: [
    {
      label: "Annual Family Membership — Premium Turf + Snacks Combo Plan",
      sub: "1 hr x Rs 1,200, discounted",
      qty: "12 courts",
      amount: 123456,
    },
    { label: "Tea", sub: "2 x Rs 15", qty: 2, amount: 30 },
  ],
  totals: [
    { label: "Paid", value: "Rs 500" },
    { label: "Balance due", value: "Rs 1,22,986" },
    { label: "GRAND TOTAL", value: "Rs 1,23,486", strong: true },
    { label: "Status", value: "PARTIAL" },
  ],
  fileName: "premium-layout-test",
};

// A bill long enough to stress the A5 QR-shrink loop — see the documented
// A5-capacity edge case (10 items + full letterhead can overflow the fixed
// A5 sheet height by design; this only asserts the renderer degrades
// gracefully, not that it fits).
const TEN_ITEM_DOC: ReceiptDoc = {
  ...PATHOLOGICAL_DOC,
  lines: Array.from({ length: 10 }, (_, i) => ({
    label: `Item number ${i + 1} with a moderately long description`,
    sub: `1 x Rs ${(i + 1) * 100}`,
    qty: i + 1,
    amount: (i + 1) * 100,
  })),
};

describe("buildPremiumReceiptPdf() — paper routing", () => {
  it("returns null for paper sizes with no dedicated premium layout", () => {
    for (const paper of NON_PREMIUM_PAPERS) {
      const settings = premiumSettings({ paper, customWidthMm: 72 });
      expect(buildPremiumReceiptPdf(PATHOLOGICAL_DOC, settings)).toBeNull();
    }
  });

  it("returns a real PDF for every premium-covered paper size", () => {
    for (const paper of PREMIUM_PAPERS) {
      const settings = premiumSettings({ paper });
      expect(buildPremiumReceiptPdf(PATHOLOGICAL_DOC, settings)).not.toBeNull();
    }
  });
});

describe("buildPremiumReceiptPdf() — renders without throwing across paper x text size x UPI", () => {
  for (const paper of PREMIUM_PAPERS) {
    for (const fontScale of FONT_SCALES) {
      for (const upiId of ["", "shopname@okhdfcbank"]) {
        it(`"${paper}" at ${fontScale}x text${upiId ? " with a UPI QR" : ""}`, () => {
          const settings = premiumSettings({ paper, fontScale, upiId });
          expect(() =>
            buildPremiumReceiptPdf(PATHOLOGICAL_DOC, settings),
          ).not.toThrow();
        });
      }
    }
  }

  it("the documented A5 capacity edge case (10 items + letterhead + QR) still renders without throwing", () => {
    const settings = premiumSettings({
      paper: "a5",
      upiId: "shopname@okhdfcbank",
    });
    expect(() => buildPremiumReceiptPdf(TEN_ITEM_DOC, settings)).not.toThrow();
  });
});

describe("buildPremiumReceiptPdf() — text never overflows the printable width", () => {
  const EDGE_TOLERANCE_MM = 0.5;

  for (const paper of PREMIUM_PAPERS) {
    it(`keeps every drawn text call within the printable width on "${paper}"`, () => {
      const settings = premiumSettings({
        paper,
        fontScale: 1.3,
        upiId: "shopname@okhdfcbank",
      });
      const calls = captureTextCalls(() =>
        buildPremiumReceiptPdf(PATHOLOGICAL_DOC, settings),
      );
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) {
        if (c.align === "right") {
          expect(c.x - c.width).toBeGreaterThanOrEqual(-EDGE_TOLERANCE_MM);
        } else if (c.align === "center") {
          expect(c.x - c.width / 2).toBeGreaterThanOrEqual(-EDGE_TOLERANCE_MM);
          expect(c.x + c.width / 2).toBeLessThanOrEqual(
            c.pageWidth + EDGE_TOLERANCE_MM,
          );
        } else {
          expect(c.x + c.width).toBeLessThanOrEqual(
            c.pageWidth + EDGE_TOLERANCE_MM,
          );
        }
      }
    });
  }
});

describe("renderCondensed() field() — 58/50mm doc-info truncation", () => {
  // Regression test for the fixed bug: the 50/58mm CUST/PH/etc. fields used
  // to truncate a long value to a flat 24 characters regardless of the
  // column's actual measured width, instead of measuring like every other
  // truncation path in the app. A wide-glyph 24-character string can still
  // be much wider than the narrow 50mm column has room for.
  it("never draws a doc-info value wider than the space left after its label, on the narrowest paper", () => {
    const settings = premiumSettings({
      paper: "50mm",
      fontScale: 1.3,
      upiId: "",
    });
    const wideGlyphDoc: ReceiptDoc = {
      ...PATHOLOGICAL_DOC,
      customer: "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW", // worst-case wide glyphs
    };
    const calls = captureTextCalls(() =>
      buildPremiumReceiptPdf(wideGlyphDoc, settings),
    );
    const pageWidth = calls[0]?.pageWidth ?? 0;
    expect(pageWidth).toBeGreaterThan(0);
    for (const c of calls) {
      if (c.align === undefined) {
        expect(c.x + c.width).toBeLessThanOrEqual(pageWidth + 0.5);
      }
    }
  });

  it("truncates with an ellipsis rather than a silent flat character-count cut", () => {
    const settings = premiumSettings({
      paper: "50mm",
      fontScale: 1.3,
      upiId: "",
    });
    const veryLongName = "A".repeat(60);
    const doc: ReceiptDoc = { ...PATHOLOGICAL_DOC, customer: veryLongName };
    const calls = captureTextCalls(() => buildPremiumReceiptPdf(doc, settings));
    // The CUST value is drawn starting with the same run of "A"s the label
    // was truncated from — find the longest such run among captured calls.
    const truncated = calls.find(
      (c) => c.text.startsWith("AAAA") && c.text !== veryLongName,
    );
    expect(truncated).toBeDefined();
    expect(truncated!.text.endsWith("…")).toBe(true);
    // Never the old hardcoded-24-chars-no-ellipsis behaviour.
    expect(truncated!.text).not.toBe(veryLongName.slice(0, 24));
  });
});

describe("buildPremiumReceiptPdf() — roll layout's blank-title info card", () => {
  it("never draws a 'DETAILS' heading on the 80mm roll's second info card", () => {
    const settings = premiumSettings({ paper: "80mm", upiId: "" });
    const calls = captureTextCalls(() =>
      buildPremiumReceiptPdf(PATHOLOGICAL_DOC, settings),
    );
    expect(calls.some((c) => c.text === "DETAILS")).toBe(false);
  });

  it("still draws the 'BILL TO' heading, which does have a title on every layout", () => {
    const settings = premiumSettings({ paper: "80mm", upiId: "" });
    const calls = captureTextCalls(() =>
      buildPremiumReceiptPdf(PATHOLOGICAL_DOC, settings),
    );
    expect(calls.some((c) => c.text === "BILL TO")).toBe(true);
  });
});

describe("UPI panel — estimateUpiPanelHeight() matches what drawUpiPanel() actually draws", () => {
  // Both functions now share one sizing formula (panelMetrics) instead of
  // keeping duplicated copies in sync by hand — this locks that invariant in
  // as a real assertion instead of a "keep in sync" code comment.
  const base = {
    x: 0,
    y: 0,
    width: 100,
    upiId: "shop@upi",
    payeeName: "Shop",
    reference: "INV-1",
    scale: 1,
    navy: [24, 40, 79] as [number, number, number],
    gold: [199, 161, 60] as [number, number, number],
    fill: [242, 244, 248] as [number, number, number],
    green: [30, 130, 76] as [number, number, number],
  };

  for (const variant of ["wide", "roll"] as const) {
    for (const qrSize of [undefined, 30, 18, 10]) {
      for (const balanceText of [null, "Rs 500"]) {
        it(`variant=${variant} qrSize=${qrSize ?? "default"} balance=${balanceText ?? "none"}`, () => {
          const pdf = new jsPDF({ unit: "mm", format: [200, 200] });
          const estimated = estimateUpiPanelHeight({
            width: base.width,
            scale: base.scale,
            variant,
            qrSize,
            hasBalance: !!balanceText,
            paid: false,
          });
          const drawn = drawUpiPanel(pdf, {
            ...base,
            variant,
            qrSize,
            balanceText,
            status: "UNPAID",
          });
          expect(drawn).toBeCloseTo(estimated, 5);
        });
      }
    }
  }
});

describe("upiUri() — static UPI deep link", () => {
  it("never includes an amount parameter (payer types it in)", () => {
    const uri = upiUri({
      upiId: "shop@upi",
      payeeName: "Shop",
      note: "Bill 1",
    });
    expect(uri).not.toContain("am=");
  });

  it("caps the note at UPI apps' 50-character limit", () => {
    const uri = upiUri({ upiId: "shop@upi", note: "x".repeat(80) });
    const tn = new URL(uri.replace("upi://", "https://")).searchParams.get(
      "tn",
    );
    expect(tn?.length).toBeLessThanOrEqual(50);
  });
});
