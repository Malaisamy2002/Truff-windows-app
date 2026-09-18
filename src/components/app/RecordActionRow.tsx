import { Printer, Download, Share2, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { whatsappUrl, copyText } from "@/lib/biz";
import {
  printReceipt,
  downloadReceipt,
  receiptText,
  type ReceiptDoc,
} from "@/lib/receipt";
import { openExternal, type InvoiceSection } from "@/lib/desktop";
import { describeError } from "@/lib/error-capture";

/**
 * Print / Download PDF / Share on WhatsApp / Copy — the row-level action
 * block that turf bookings (`TurfTab`) and snack sales (`SnackSalesList`)
 * both render per-record. Pulled out once both had grown byte-for-byte
 * identical copies of these four buttons (Step 18 added them to bookings,
 * Step 19 mirrored them to snack sales) so a future change to this block
 * — a new action, a wording tweak, a different icon — happens once
 * instead of twice and can't quietly drift the way the pre-Step-18
 * Print/Download buttons already had before being compared directly.
 *
 * Deliberately NOT used by `BillsTab`/`BillActions.tsx`: bills render a
 * larger, labeled 4–5 button grid (including a UPI-pay option gated on
 * Settings) as their primary action surface, not a compact icon row
 * inside a list item — a different UI weight for the app's most formal
 * record type, not an oversight. If bills ever move to this same compact
 * treatment, `BillActions.tsx` should compose this component rather than
 * this component growing bill-specific props.
 *
 * Takes an already-built `ReceiptDoc` rather than a `TurfBooking` /
 * `SnackSale` — the caller still owns `bookingReceipt(b)` /
 * `snackSaleReceipt(s)`, so this component has no record-type-specific
 * logic of its own and needs no changes if a third record type
 * (invoices, if `BillsTab` ever adopts this shape) is added later.
 */
export function RecordActionRow({
  doc,
  phone,
  section,
  noun,
  size = "touch",
}: {
  doc: ReceiptDoc;
  /** Customer's phone, if known — passed straight to `whatsappUrl()`,
   * which already degrades gracefully (opens WhatsApp's own contact
   * picker) for `null`/invalid numbers, so callers that can't resolve a
   * phone (see `customerPhoneForName()`'s conservative exact-match rule)
   * can simply pass `null` rather than special-casing it. */
  phone: string | null | undefined;
  section: InvoiceSection;
  /** Feeds the aria-label/title wording — "booking receipt", "snack
   * bill" — so screen-reader users still hear which record type a given
   * row's buttons act on, matching the specificity the pre-extraction
   * per-file labels already had. */
  noun: string;
  size?: "touch" | "sm";
}) {
  return (
    <>
      <Button
        size={size}
        variant="outline"
        aria-label={`Print ${noun}`}
        title="Print"
        onClick={async () => {
          // printReceipt() already shows its own success/failure toast for
          // every path it can reach — this catch is only a safety net for a
          // failure *before* that (e.g. buildReceiptPdf() throwing on a
          // malformed doc), which would otherwise reach the app's
          // unhandledrejection listener and stop there: that listener only
          // records the error for SSR debugging, never shows the user
          // anything, so without this the button would just look like it
          // did nothing.
          try {
            await printReceipt(doc, undefined, section);
          } catch (e) {
            toast.error("Couldn't print", { description: describeError(e) });
          }
        }}
      >
        <Printer className="h-4 w-4" />
      </Button>
      <Button
        size={size}
        variant="outline"
        aria-label={`Download ${noun}`}
        title="Download PDF"
        onClick={async () => {
          // Same safety-net reasoning as Print above.
          try {
            await downloadReceipt(doc, undefined, section);
          } catch (e) {
            toast.error("Couldn't download PDF", {
              description: describeError(e),
            });
          }
        }}
      >
        <Download className="h-4 w-4" />
      </Button>
      <Button
        size={size}
        variant="outline"
        aria-label={`Share ${noun} on WhatsApp`}
        title="Share on WhatsApp"
        onClick={async () => {
          // Raw window.open() doesn't work here: inside the Tauri webview
          // (both the Windows desktop shell and the Android shell) it's
          // either a silent no-op or spawns a stray chrome-less webview
          // instead of handing the link to WhatsApp — the exact reason
          // openExternal() exists (see its doc comment in desktop.ts) and
          // is already used by every other WhatsApp button in the app.
          //
          // openExternal() never throws, but it does return `false` when
          // both its primary route and its own fallback fail — that result
          // was previously discarded, so a full failure showed nothing at
          // all. Surface it the same way the other three buttons already
          // surface theirs.
          const url = whatsappUrl(receiptText(doc), phone);
          const opened = await openExternal(url);
          if (!opened) {
            toast.error("Couldn't open WhatsApp", {
              description: "Try Copy instead and paste it into WhatsApp.",
            });
          }
        }}
      >
        <Share2 className="h-4 w-4" />
      </Button>
      <Button
        size={size}
        variant="outline"
        aria-label={`Copy ${noun}`}
        title="Copy"
        onClick={async () => {
          const ok = await copyText(receiptText(doc));
          if (ok) toast.success("Copied");
          else toast.error("Copy failed");
        }}
      >
        <Copy className="h-4 w-4" />
      </Button>
    </>
  );
}
