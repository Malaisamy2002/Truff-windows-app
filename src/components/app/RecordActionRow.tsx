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
import type { InvoiceSection } from "@/lib/desktop";

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
        onClick={() => printReceipt(doc, undefined, section)}
      >
        <Printer className="h-4 w-4" />
      </Button>
      <Button
        size={size}
        variant="outline"
        aria-label={`Download ${noun}`}
        title="Download PDF"
        onClick={() => downloadReceipt(doc, undefined, section)}
      >
        <Download className="h-4 w-4" />
      </Button>
      <Button
        size={size}
        variant="outline"
        aria-label={`Share ${noun} on WhatsApp`}
        title="Share on WhatsApp"
        onClick={() => {
          const url = whatsappUrl(receiptText(doc), phone);
          window.open(url, "_blank");
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
