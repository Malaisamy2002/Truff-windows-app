import { Copy, Download, Eye, Printer, QrCode, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { billText, copyText, whatsappUrl, type Bill } from "@/lib/biz";
import {
  billReceipt,
  downloadBillPdf,
  printBillPdf,
  shareBillPdf,
} from "@/lib/receipt";
import { INVOICE_SECTIONS, type InvoiceSection } from "@/lib/desktop";
import { usePrintSettings } from "@/lib/print";
import { upiUri } from "@/lib/receipt-upi";
import { usePrintPreview } from "@/lib/use-print-preview";
import { describeError } from "@/lib/error-capture";

export function BillActions({
  bill,
  section = INVOICE_SECTIONS.bills,
  restricted = false,
}: {
  bill: Bill;
  /** Which `Invoices/` subfolder this bill's saved files go in — pass
   * "Merged" for bills produced by merging turf/snack records so they
   * land separately from ordinary bills. Defaults to "Bills". */
  section?: InvoiceSection;
  /** True once the bill's balance has moved onto the customer's tab, or the
   * bill has been cancelled (greyed out in the list either way). Such bills
   * are read-only everywhere except PDF download and Print — WhatsApp share
   * and Copy are disabled since the bill text/number is no longer how this
   * money gets collected (moved) or isn't real money at all (cancelled). */
  restricted?: boolean;
}) {
  const { settings } = usePrintSettings();
  const upiId = settings.upiId.trim();
  const { openPreview, previewDialog } = usePrintPreview();

  const payViaUpi = () => {
    const uri = upiUri({
      upiId,
      payeeName: settings.shopName,
      note: `Bill ${bill.invoice_no}`,
    });
    // upi:// only means anything to a UPI app, so treat it as a link the OS
    // hands off to GPay/PhonePe/etc. rather than something to fetch — same
    // navigation a plain <a href="upi://..."> would do, which also degrades
    // harmlessly (no-op) where nothing can open it, e.g. the Windows desktop
    // build. window.location.href triggers that hand-off reliably in the
    // Android WebView, where window.open often gets swallowed.
    window.location.href = uri;
  };

  return (
    <>
      <div
        className={`grid grid-cols-2 gap-2 ${upiId ? "sm:grid-cols-6" : "sm:grid-cols-5"}`}
      >
        <Button
          variant="outline"
          className="lift h-12"
          onClick={async () => {
            // downloadBillPdf() shows its own toast on every path it can
            // reach; this catch only guards the same class of pre-toast
            // failure (a bad doc throwing inside PDF generation) that
            // RecordActionRow's Download button guards against —
            // otherwise the tap just looks like it did nothing.
            try {
              await downloadBillPdf(bill, section);
            } catch (e) {
              toast.error("Couldn't download PDF", {
                description: describeError(e),
              });
            }
          }}
        >
          <Download className="size-4" /> PDF
        </Button>
        <Button
          variant="outline"
          className="lift h-12"
          aria-label="Print bill"
          title="Print"
          onClick={async () => {
            try {
              await printBillPdf(bill, section);
            } catch (e) {
              toast.error("Couldn't print", {
                description: describeError(e),
              });
            }
          }}
        >
          <Printer className="size-4" /> Print
        </Button>
        <Button
          variant="outline"
          className="lift h-12"
          aria-label="Preview bill before printing"
          title="Preview"
          onClick={() => {
            try {
              openPreview(billReceipt(bill), section);
            } catch (e) {
              toast.error("Couldn't open preview", {
                description: describeError(e),
              });
            }
          }}
        >
          <Eye className="size-4" /> Preview
        </Button>
        <Button
          className="lift h-12"
          aria-label="Share on WhatsApp"
          title="Share on WhatsApp"
          disabled={restricted}
          onClick={async () => {
            try {
              const res = await shareBillPdf(
                bill,
                whatsappUrl(billText(bill), bill.customer_phone),
                section,
              );
              if (res === "fallback")
                toast.info("PDF downloaded — attach it in WhatsApp");
              // "cancelled" (Web Share dismissed, or an Android save
              // failure — which already showed its own error toast)
              // intentionally shows nothing further here.
            } catch (e) {
              toast.error("Couldn't share", {
                description: describeError(e),
              });
            }
          }}
        >
          <Share2 className="size-4" /> WhatsApp
        </Button>
        <Button
          variant="outline"
          className="lift h-12"
          aria-label="Copy bill"
          title="Copy"
          disabled={restricted}
          onClick={async () => {
            const ok = await copyText(billText(bill));
            if (ok) toast.success("Bill copied");
            else toast.error("Copy failed");
          }}
        >
          <Copy className="size-4" />
        </Button>
        {upiId && (
          <Button
            variant="outline"
            className="lift h-12"
            aria-label="Pay via UPI"
            title="Pay via UPI"
            onClick={payViaUpi}
          >
            <QrCode className="size-4" /> Pay via UPI
          </Button>
        )}
      </div>
      {previewDialog}
    </>
  );
}
