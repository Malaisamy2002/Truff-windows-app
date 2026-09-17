/**
 * In-app printer selection for the desktop shell — lets the person pick a
 * specific installed Windows printer once in Print Settings, then have
 * "Print" go straight to it (see the `"named-printer"` `printMethod` in
 * `print.ts`), instead of the OS printer-picker dialog appearing every
 * single time.
 *
 * Both functions call into the `list_printers` / `print_file_to_printer`
 * Rust commands in `src-tauri/src/lib.rs`, which are only registered on
 * non-Android desktop builds and only actually work on real Windows (they
 * shell out to PowerShell). Every failure path here — no Tauri runtime
 * (browser/PWA), command not registered, PowerShell not found, printer
 * offline — resolves to an empty list / a thrown `Error` with a real
 * message, never a silent crash, so callers can fall back to the ordinary
 * dialog-based print method.
 */

async function invokeTauri<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Printer names as reported by Windows. Empty outside the desktop shell,
 * or if detection fails for any reason (PowerShell missing, no printers,
 * running the browser/PWA build, etc.) — never throws. */
export async function listAvailablePrinters(): Promise<string[]> {
  try {
    const names = await invokeTauri<string[]>("list_printers");
    return Array.isArray(names) ? names.filter((n) => n.trim().length > 0) : [];
  } catch {
    return [];
  }
}

/**
 * Sends the file at `path` straight to `printer`, no dialog. Throws a
 * descriptive `Error` on any failure — callers should catch it and offer
 * the ordinary dialog-based print method instead, the same pattern already
 * used for `printPdfBytesAsImages` in `print-raster.ts`.
 */
export async function printFileToPrinter(
  path: string,
  printer: string,
): Promise<void> {
  if (!printer.trim()) {
    throw new Error("No printer selected — choose one in Print Settings.");
  }
  await invokeTauri<void>("print_file_to_printer", { path, printer });
}
