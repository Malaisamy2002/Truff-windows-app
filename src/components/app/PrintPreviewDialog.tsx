import { useEffect, useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { InvoiceSection } from "@/lib/desktop";
import {
  PAPER_TYPES,
  PRINT_METHOD_OPTIONS,
  usePrintSettings,
  type PaperId,
  type PrintMethod,
  type PrintSettings,
} from "@/lib/print";
import {
  buildReceiptPdf,
  downloadReceipt,
  printReceipt,
  type ReceiptDoc,
} from "@/lib/receipt";

export type PreviewRequest = {
  doc: ReceiptDoc;
  section: InvoiceSection | undefined;
} | null;

/**
 * Windows-only "preview before printing" flow. Renders the *actual* document
 * (not a sample, unlike the Settings → Print "Preview layout" button) with
 * quick, per-print overrides for paper, copies, and print method.
 *
 * Deliberately not wired into the existing Print buttons across the app —
 * those stay a single click, unchanged, for the operator who already knows
 * their setup. This is an additional "Preview" action next to them for
 * anyone who wants to check a layout or try a different paper size for one
 * receipt without leaving the screen or touching their saved defaults.
 *
 * Overrides made here are never written back to Settings → Print — closing
 * or printing from this dialog discards them. That is a deliberate choice:
 * a customer who wants an A4 copy "just this once" shouldn't silently
 * change what every future thermal receipt prints on.
 */
export function PrintPreviewDialog({
  request,
  onOpenChange,
}: {
  request: PreviewRequest;
  onOpenChange: (open: boolean) => void;
}) {
  const { settings: savedSettings } = usePrintSettings();
  // Local, per-print overrides — reseeded from the saved defaults every time
  // the dialog opens, discarded on close/print/download. Only the three
  // knobs that matter most for "pick a printer/paper for this one receipt"
  // are exposed here; density/spacing/branding stay in Settings → Print.
  const [paper, setPaper] = useState<PaperId>(savedSettings.paper);
  const [copies, setCopies] = useState(savedSettings.copies);
  const [printMethod, setPrintMethod] = useState<PrintMethod>(
    savedSettings.printMethod,
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    setPaper(savedSettings.paper);
    setCopies(savedSettings.copies);
    setPrintMethod(savedSettings.printMethod);
    // Reseed on every open (a new `request` object) using whatever Settings
    // currently holds — intentionally not reacting to savedSettings changing
    // while already open, so mid-preview edits here aren't clobbered by an
    // unrelated Settings change in another tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const effectiveSettings: PrintSettings = useMemo(
    () => ({ ...savedSettings, paper, copies, printMethod }),
    [savedSettings, paper, copies, printMethod],
  );

  useEffect(() => {
    if (!request) {
      setPreviewUrl(null);
      return;
    }
    try {
      const pdf = buildReceiptPdf(request.doc, effectiveSettings);
      const url = URL.createObjectURL(pdf.output("blob") as Blob);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    } catch {
      setPreviewUrl(null);
      return;
    }
  }, [request, effectiveSettings]);

  const close = () => onOpenChange(false);

  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[85vh] max-w-4xl grid-rows-[auto_auto_minmax(0,1fr)] gap-3 p-4 sm:rounded-xl">
        <DialogHeader className="pr-8">
          <DialogTitle>
            {request ? `Preview — ${request.doc.docNo}` : "Preview"}
          </DialogTitle>
          <DialogDescription>
            This is the actual receipt, laid out with the paper and copies
            chosen below. Changes here apply to this print only — Settings →
            Print keeps its own saved defaults.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/40 p-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              Paper / printer type
            </span>
            <Select value={paper} onValueChange={(v) => setPaper(v as PaperId)}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAPER_TYPES.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Copies</span>
            <Select
              value={String(copies)}
              onValueChange={(v) => setCopies(Number(v))}
            >
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Print method</span>
            <ToggleGroup
              type="single"
              variant="outline"
              value={printMethod}
              onValueChange={(v) => v && setPrintMethod(v as PrintMethod)}
            >
              {PRINT_METHOD_OPTIONS.map((opt) => (
                <ToggleGroupItem
                  key={opt.id}
                  value={opt.id}
                  className="text-xs"
                >
                  {opt.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>

        {previewUrl ? (
          <object
            aria-label="Receipt preview"
            className="h-full min-h-0 w-full rounded-md border bg-muted"
            data={previewUrl}
            type="application/pdf"
          >
            <p className="p-4 text-sm text-muted-foreground">
              PDF preview is unavailable on this device.
            </p>
          </object>
        ) : (
          <div className="h-full min-h-0 w-full rounded-md border bg-muted" />
        )}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (!request) return;
              downloadReceipt(request.doc, effectiveSettings, request.section);
              close();
            }}
          >
            <Download className="mr-1 h-4 w-4" /> Download PDF
          </Button>
          <Button
            onClick={() => {
              if (!request) return;
              printReceipt(request.doc, effectiveSettings, request.section);
              close();
            }}
          >
            <Printer className="mr-1 h-4 w-4" /> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
