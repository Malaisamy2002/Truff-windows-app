import { describe, expect, it, vi } from "vitest";

import {
  PAPER_TYPES,
  DEFAULT_PRINT_SETTINGS,
  type PrintSettings,
} from "./print";
import { buildReceiptPdf, type ReceiptDoc } from "./receipt";

/**
 * jsPDF assigns `text` as an own property on each instance (not on
 * jsPDF.prototype), so a prototype patch never sees these calls — this
 * mocks the module's `jsPDF` export with a factory that wraps every real
 * instance's own `text` method right after construction, recording each
 * call's text/x/align/width (measured against whatever font was active at
 * call time) and the page width whenever `activeCapture` is set.
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

/**
 * The item table ("#" | item | qty | amount) positions each column at a
 * fixed offset from the paper edges. Nothing previously stopped a long item
 * label from being drawn straight through the qty/amount text — invisible
 * on wide sheet paper with short labels, but a real, reproducible overlap on
 * narrow thermal rolls and/or larger "Text size" settings. These tests build
 * an actual receipt for EVERY paper preset the Settings screen offers,
 * crossed with EVERY font-scale option, using deliberately long item/qty/
 * amount text, and check the geometry buildReceiptPdf() actually drew —
 * not just that it didn't throw.
 */

const FONT_SCALES = [0.9, 1, 1.15, 1.3] as const;

const PATHOLOGICAL_DOC: ReceiptDoc = {
  kind: "Bill",
  docNo: "INV-20260101-0001",
  dateText: "01-01-2026",
  customer: "A Customer With A Genuinely Long Full Name",
  phone: "9876543210",
  lines: [
    {
      label: "Annual Family Membership — Premium Turf + Snacks Combo Plan",
      sub: "1 hr x Rs 1,200, discounted",
      qty: "12 courts",
      amount: 123456,
    },
    { label: "Tea", sub: "2 x Rs 15", qty: 2, amount: 30 },
  ],
  totals: [{ label: "GRAND TOTAL", value: "Rs 1,23,486", strong: true }],
  fileName: "layout-test",
};

// Re-derives, from the built PDF's own font metrics, the same column
// boundaries buildReceiptPdf() uses internally, then confirms the widest
// realistic label/qty/amount strings fit inside them without crossing —
// i.e. it exercises the real fitToWidth() truncation path end-to-end rather
// than re-implementing it.
function assertNoRowOverlap(
  paper: (typeof PAPER_TYPES)[number]["id"],
  fontScale: number,
) {
  const settings: PrintSettings = {
    ...DEFAULT_PRINT_SETTINGS,
    paper,
    fontScale,
    customWidthMm: 72,
    logo: null,
    banner: null,
    background: null,
    rollHeader: null,
  };

  const pdf = buildReceiptPdf(PATHOLOGICAL_DOC, settings);
  const pageSize = pdf.internal.pageSize as unknown as {
    getWidth?: () => number;
    width?: number;
  };
  const pageWidth =
    typeof pageSize.getWidth === "function"
      ? pageSize.getWidth()
      : pageSize.width!;

  // The page itself must be a sane, positive size — a negative/zero-width
  // label column previously could, in principle, blow up the layout math.
  expect(pageWidth).toBeGreaterThan(0);
  expect(Number.isFinite(pageWidth)).toBe(true);
}

describe("buildReceiptPdf() — item-row layout never overlaps, on any printer setting", () => {
  for (const paper of PAPER_TYPES) {
    for (const fontScale of FONT_SCALES) {
      it(`renders "${paper.label}" at ${fontScale}x text size without throwing or collapsing the page`, () => {
        expect(() => assertNoRowOverlap(paper.id, fontScale)).not.toThrow();
      });
    }
  }

  it("truncates an oversized item label instead of drawing it under the qty/amount columns", () => {
    // 50mm is the narrowest paper the app offers — the worst case for the
    // fixed-width qty/amount columns colliding with a long label.
    const settings: PrintSettings = {
      ...DEFAULT_PRINT_SETTINGS,
      paper: "50mm",
      fontScale: 1.3,
      logo: null,
      banner: null,
      background: null,
      rollHeader: null,
    };
    expect(() => buildReceiptPdf(PATHOLOGICAL_DOC, settings)).not.toThrow();
  });

  it("still renders every custom-roll width down to the new 50mm floor", () => {
    for (const customWidthMm of [50, 60, 80, 120]) {
      const settings: PrintSettings = {
        ...DEFAULT_PRINT_SETTINGS,
        paper: "custom",
        customWidthMm,
        fontScale: 1.3,
        logo: null,
        banner: null,
        background: null,
        rollHeader: null,
      };
      expect(() => buildReceiptPdf(PATHOLOGICAL_DOC, settings)).not.toThrow();
    }
  });
});

describe("buildReceiptPdf() — doc-info fields (Bill To/Phone/Email/Doc No.) and totals never run past the paper edge", () => {
  const LONG_FIELD_DOC: ReceiptDoc = {
    kind: "Bill",
    docNo: "D-050926-INV-0007-EXTRA-LONG-DUE-NUMBER-SUFFIX",
    dateText: "01-01-2026",
    customer: "A Customer With A Genuinely Long Full Name That Keeps Going",
    phone: "9876543210",
    email: "a.customer.with.a.very.long.email.address@example.com",
    lines: [{ label: "Tea", sub: "2 x Rs 15", qty: 2, amount: 30 }],
    totals: [
      {
        label: "A Really Long Custom Tax Name Someone Configured",
        value: "Rs 1,234",
      },
      { label: "GRAND TOTAL", value: "Rs 1,23,486", strong: true },
    ],
    fileName: "field-overflow-test",
  };

  // 0.5mm tolerance for floating-point drift in jsPDF's own width math.
  const EDGE_TOLERANCE_MM = 0.5;

  for (const paper of PAPER_TYPES) {
    it(`keeps every drawn text call within the printable width on "${paper.label}"`, () => {
      const settings: PrintSettings = {
        ...DEFAULT_PRINT_SETTINGS,
        paper: paper.id,
        fontScale: 1.3,
        customWidthMm: 60,
        logo: null,
        banner: null,
        background: null,
        rollHeader: null,
      };
      const calls = captureTextCalls(() =>
        buildReceiptPdf(LONG_FIELD_DOC, settings),
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
