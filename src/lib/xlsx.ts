import ExcelJS from "exceljs";
import { toast } from "sonner";
import {
  describeSaveError,
  isAndroid,
  isDesktop,
  revealInFolder,
  saveExportFile,
  saveToInvoicesFolder,
  type InvoiceSection,
} from "./desktop";

import { dayKey } from "./analytics";

export type SheetRow = Record<string, string | number>;

/**
 * A sheet spec is either the plain flat-table shape (`rows`, rendered via
 * `json_to_sheet`-style header + row dump) or a `build` callback for sheets
 * that need real styling — merged cells, fills, conditional formatting —
 * that a flat row list can't express. `build` gets the freshly-created
 * worksheet and does whatever it needs directly against the ExcelJS API.
 *
 * The flat shape also accepts two opt-in flags for record-level "raw data"
 * sheets: `autofilter` adds a filter dropdown to the header row and freezes
 * it so it stays visible while scrolling, and `moneyColumns` right-aligns
 * and thousand-separates the named columns instead of leaving them as plain
 * numbers. Existing callers that don't pass these get the exact same output
 * as before.
 */
export type SheetSpec =
  | {
      name: string;
      rows: SheetRow[];
      autofilter?: boolean;
      moneyColumns?: string[];
    }
  | { name: string; build: (ws: ExcelJS.Worksheet) => void };

/** Download an array of flat objects as an .xlsx file. */
export function exportToExcel(
  rows: SheetRow[],
  filename: string,
  sheetName = "Sheet1",
  section?: InvoiceSection,
) {
  return exportWorkbook([{ name: sheetName, rows }], filename, section);
}

/**
 * Download several sheets in one workbook. Empty flat-row sheets are kept
 * with a placeholder row.
 *
 * In the browser/PWA we build the workbook bytes with ExcelJS and trigger a
 * Blob + `<a download>` click ourselves (ExcelJS has no writeFile-style
 * browser helper like SheetJS did). The desktop shell's Tauri WebView can't
 * do that trick either — same reason receipt.ts and backup.ts fork on
 * `isDesktop()` — so there we write the same bytes straight into the app's
 * shared `Invoices/` folder via `saveToInvoicesFolder` (desktop.ts) and
 * reveal the file in Explorer, exactly like `downloadReceipt` does.
 */
export async function exportWorkbook(
  sheets: SheetSpec[],
  filename: string,
  section?: InvoiceSection,
): Promise<boolean> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));

    if ("build" in s) {
      s.build(ws);
      continue;
    }

    const rows = s.rows.length ? s.rows : [{ Info: "No records" }];
    const keys = Object.keys(rows[0] ?? {});
    ws.columns = keys.map((k) => ({
      header: k,
      key: k,
      width: Math.min(
        32,
        Math.max(
          k.length + 2,
          ...rows.map((r) => String(r[k] ?? "").length + 2),
        ),
      ),
    }));
    ws.getRow(1).font = { bold: true };

    for (const r of rows) ws.addRow(r);

    // Only meaningful when there's real data — an empty sheet just has the
    // "No records" placeholder row, which a filter/format pass would target
    // pointlessly (and "No records" isn't a number `moneyColumns` could
    // format anyway).
    if (rows.length && s.rows.length) {
      if (s.moneyColumns?.length) {
        for (const col of s.moneyColumns) {
          const idx = keys.indexOf(col);
          if (idx === -1) continue;
          ws.getColumn(idx + 1).numFmt = "#,##0";
        }
      }
      if (s.autofilter) {
        ws.views = [{ state: "frozen", ySplit: 1 }];
        ws.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: rows.length + 1, column: keys.length },
        };
      }
    }
  }
  const name = `${filename}-${dayKey(new Date())}.xlsx`;
  let buffer: ArrayBuffer;
  try {
    buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  } catch (e) {
    // A big workbook can fail here (out of memory while zipping). Say so
    // instead of the old bare "Excel export failed" with no reason.
    toast.error("Excel export failed", { description: describeSaveError(e) });
    return false;
  }

  // An empty/near-empty buffer means nothing usable was produced — never
  // report success for a 0-byte file.
  if (!buffer || buffer.byteLength === 0) {
    toast.error("Excel export failed", {
      description: "No data was produced for the file.",
    });
    return false;
  }

  // Checked before the generic isDesktop() branch — Android satisfies
  // isDesktop() too, but its $DOCUMENT fs-scope write isn't reliably visible
  // to the user there. See saveExportFile's doc comment in desktop.ts.
  if (isAndroid()) {
    const result = await saveExportFile(
      new Uint8Array(buffer),
      name,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    if (result.saved) {
      toast.success("Excel file saved to Downloads", { description: name });
      return true;
    }
    toast.error("Couldn't save Excel file", {
      description: result.error ?? name,
    });
    return false;
  }

  if (isDesktop()) {
    try {
      const abs = await saveToInvoicesFolder(
        new Uint8Array(buffer),
        name,
        section,
      );
      await revealInFolder(abs);
    } catch (e) {
      // The write itself can fail (folder not writable, disk full). This
      // used to throw past the caller while no toast ever appeared.
      toast.error("Couldn't save Excel file", {
        description: describeSaveError(e),
      });
      return false;
    }
    toast.success("Excel file saved", { description: name });
    return true;
  }

  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast.success("Excel file downloaded", { description: name });
  return true;
}
