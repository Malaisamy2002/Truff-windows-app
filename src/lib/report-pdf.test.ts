import { describe, expect, it, vi } from "vitest";

import { buildReportPdf, type ReportPdfDoc } from "./report-pdf";
import { DEFAULT_PRINT_SETTINGS } from "./print";

/**
 * Table cells here were previously drawn with plain pdf.text(cell, x, ...)
 * and no width check at all — a long customer name or item description in
 * a report table ran straight into the next column. These tests build a
 * report with deliberately long header/cell text and check the geometry
 * buildReportPdf() actually drew, the same way receipt-layout.test.ts does
 * for buildReceiptPdf().
 *
 * jsPDF assigns `text` as an own property on each instance (not on
 * jsPDF.prototype), so this mocks the module's `jsPDF` export with a
 * factory that wraps every real instance's own `text` method right after
 * construction, recording calls whenever `activeCapture` is set.
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

const PATHOLOGICAL_REPORT: ReportPdfDoc = {
  title: "Monthly Statement",
  subtitle: "01 Jan 2026 – 31 Jan 2026",
  tables: [
    {
      title: "Expenses By An Extremely Long Category Name That Keeps Going",
      columns: [
        "A Very Long Column Header That Should Not Bleed Into The Next Column",
        "Amount",
      ],
      rows: [
        {
          cells: [
            "A customer or expense description that is genuinely very long and would otherwise run into the amount column",
            "Rs 1,23,456",
          ],
        },
        { cells: ["Short row", "Rs 10"], strong: true },
      ],
    },
  ],
  fileName: "report-overflow-test",
};

describe("buildReportPdf() — table headers and cells never run past their own column", () => {
  const EDGE_TOLERANCE_MM = 0.5;

  it("keeps every drawn text call within the page width, given pathologically long headers/cells", () => {
    const calls = captureTextCalls(() =>
      buildReportPdf(PATHOLOGICAL_REPORT, DEFAULT_PRINT_SETTINGS),
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      if (c.align === "right") {
        expect(c.x - c.width).toBeGreaterThanOrEqual(-EDGE_TOLERANCE_MM);
      } else {
        expect(c.x + c.width).toBeLessThanOrEqual(
          c.pageWidth + EDGE_TOLERANCE_MM,
        );
      }
    }
  });

  it("does not throw when building a report with an empty table", () => {
    const doc: ReportPdfDoc = {
      title: "Empty",
      subtitle: "",
      tables: [
        { title: "Nothing here", columns: ["Item", "Amount"], rows: [] },
      ],
      fileName: "empty-report",
    };
    expect(() => buildReportPdf(doc, DEFAULT_PRINT_SETTINGS)).not.toThrow();
  });
});
