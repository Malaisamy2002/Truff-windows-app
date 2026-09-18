import { useState } from "react";
import type { InvoiceSection } from "@/lib/desktop";
import type { ReceiptDoc } from "@/lib/receipt";
import {
  PrintPreviewDialog,
  type PreviewRequest,
} from "@/components/app/PrintPreviewDialog";

/**
 * Windows-only "preview before printing" flow. See `PrintPreviewDialog.tsx`
 * for the dialog itself and the design notes; this hook just owns the
 * open/closed request state so callers get `openPreview()` + a
 * ready-to-render `previewDialog` element.
 */
export function usePrintPreview() {
  const [request, setRequest] = useState<PreviewRequest>(null);
  return {
    openPreview: (doc: ReceiptDoc, section?: InvoiceSection) =>
      setRequest({ doc, section }),
    previewDialog: (
      <PrintPreviewDialog
        request={request}
        onOpenChange={(open) => {
          if (!open) setRequest(null);
        }}
      />
    ),
  };
}
