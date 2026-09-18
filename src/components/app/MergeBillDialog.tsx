import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Merge, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatDMY, money } from "@/lib/biz";
import { INVOICE_SECTIONS } from "@/lib/desktop";
import { isFinancialBooking, isFinancialSale } from "@/lib/dues";
import { buildMergedItems, mergeIntoBill, previewMerge } from "@/lib/merge";
import { usePrintSettings } from "@/lib/print";
import { printBillPdf } from "@/lib/receipt";
import { useSnackSales, useTurfBookings } from "@/lib/ops";
import { useTabEntries } from "@/lib/tabs";
import { CustomerFields } from "./CustomerFields";

/**
 * Merge recent turf bookings + snack bills into ONE bill saved in Bills.
 *
 * All the money math and every write lives in lib/merge.ts: this dialog only
 * picks the sources and shows what will happen. `previewMerge()` and
 * `mergeIntoBill()` share the same math function, so the summary line below
 * can never disagree with what is actually written.
 */
export function MergeBillDialog() {
  const [open, setOpen] = useState(false);
  const { data: bookings = [] } = useTurfBookings();
  const { data: sales = [] } = useSnackSales();
  const { data: tabEntries = [] } = useTabEntries();
  const { settings: printSettings } = usePrintSettings();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [turfIds, setTurfIds] = useState<string[]>([]);
  const [snackIds, setSnackIds] = useState<string[]>([]);
  const [putOnTab, setPutOnTab] = useState(false);
  const [saving, setSaving] = useState(false);

  const toggle = (ids: string[], set: (v: string[]) => void, id: string) =>
    set(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  // Already-merged rows are hidden: they are no longer their own financial
  // record, and lib/merge.ts refuses to merge them a second time anyway.
  const openBookings = useMemo(
    () => bookings.filter(isFinancialBooking),
    [bookings],
  );
  const openSales = useMemo(() => sales.filter(isFinancialSale), [sales]);

  const pickedBookings = useMemo(
    () => openBookings.filter((b) => turfIds.includes(b.id)),
    [openBookings, turfIds],
  );
  const pickedSales = useMemo(
    () => openSales.filter((s) => snackIds.includes(s.id)),
    [openSales, snackIds],
  );

  // All the item-building + subtotal/discount/total math lives in
  // lib/merge.ts and is shared with the actual save (mergeIntoBill), so this
  // preview can never disagree with what gets written.
  const {
    items,
    subtotal: grossTotal,
    discount: mergedDiscount,
    total,
  } = useMemo(
    () => buildMergedItems(pickedBookings, pickedSales),
    [pickedBookings, pickedSales],
  );

  const preview = useMemo(
    () =>
      previewMerge({
        total,
        bookings: pickedBookings.map((b) => ({
          id: b.id,
          advance_paid: Number(b.advance_paid) || 0,
        })),
        sales: pickedSales.map((s) => ({
          id: s.id,
          total: Number(s.total) || 0,
          payment_mode: s.payment_mode,
        })),
        tabEntries,
      }),
    [total, pickedBookings, pickedSales, tabEntries],
  );

  const reset = () => {
    setName("");
    setPhone("");
    setTurfIds([]);
    setSnackIds([]);
    setPutOnTab(false);
    setSaving(false);
  };

  const save = async () => {
    if (items.length === 0) {
      toast.error("Select at least one turf booking or snack bill");
      return;
    }
    if (!name.trim()) {
      toast.error("Customer name is required");
      return;
    }
    setSaving(true);
    try {
      const bill = await mergeIntoBill({
        name: name.trim(),
        phone: phone.trim() || null,
        bookingIds: pickedBookings.map((b) => b.id),
        saleIds: pickedSales.map((s) => s.id),
        items,
        subtotal: grossTotal,
        discount: mergedDiscount,
        total,
        putOnTab,
      });
      for (const key of [
        "bills",
        "turf_bookings",
        "snack_sales",
        "tab_entries",
        "customer_tabs",
      ])
        qc.invalidateQueries({ queryKey: [key] });
      toast.success(
        putOnTab
          ? `Bill ${bill.invoice_no} saved · ${money(preview.outstanding)} on the tab`
          : `Bill ${bill.invoice_no} saved` +
              (preview.alreadyOnTab > 0
                ? ` · ${money(preview.alreadyOnTab)} taken off the tab`
                : ""),
      );
      if (printSettings.autoPrint) printBillPdf(bill, INVOICE_SECTIONS.merged);
      setOpen(false);
      reset();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Start every merge from a clean sheet: leftover name/phone and ticked
        // bookings from an abandoned merge would otherwise be silently reused.
        if (next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="h-12 w-full">
          <Merge className="size-4" /> Merge turf + snacks bill
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Merge into one bill</DialogTitle>
          <DialogDescription>
            Pick turf bookings and snack bills, then generate a single bill
            saved here.
          </DialogDescription>
        </DialogHeader>

        <CustomerFields
          name={name}
          phone={phone}
          onChange={({ name: n, phone: p }) => {
            setName(n);
            setPhone(p);
          }}
        />

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Turf bookings</Label>
          {openBookings.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing left to merge.
            </p>
          )}
          {openBookings.slice(0, 20).map((b) => (
            <label key={b.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={turfIds.includes(b.id)}
                onCheckedChange={() => toggle(turfIds, setTurfIds, b.id)}
              />
              <span className="min-w-0 flex-1 truncate">
                {b.booking_no} · {b.customer_name} · {formatDMY(b.booking_date)}
              </span>
              <span className="font-medium">{money(b.total_amount)}</span>
            </label>
          ))}
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Snack bills</Label>
          {openSales.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing left to merge.
            </p>
          )}
          {openSales.slice(0, 20).map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={snackIds.includes(s.id)}
                onCheckedChange={() => toggle(snackIds, setSnackIds, s.id)}
              />
              <span className="min-w-0 flex-1 truncate">
                {s.bill_no}
                {s.customer_name ? ` · ${s.customer_name}` : ""} ·{" "}
                {formatDMY(s.sale_date)}
              </span>
              <span className="font-medium">{money(s.total)}</span>
            </label>
          ))}
        </div>

        <div className="space-y-2 rounded-2xl border p-3">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={putOnTab}
              onCheckedChange={(v) => setPutOnTab(Boolean(v))}
              disabled={!name.trim()}
            />
            <span className="flex-1">
              Put the balance on {name.trim() || "the customer"}'s due tab
              <span className="block text-xs text-muted-foreground">
                The merged bill is settled as “On tab”, so the due shows only in
                Outstanding — never in both places.
              </span>
            </span>
          </label>
          {items.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {money(preview.total)} total · {money(preview.collected)} already
              collected · {money(preview.outstanding)} still owed
              {preview.alreadyOnTab > 0 && (
                <> · {money(preview.alreadyOnTab)} of it already on tab</>
              )}
              {putOnTab ? (
                <>
                  {" "}
                  → tab changes by {preview.tabDelta >= 0 ? "+" : "−"}
                  {money(Math.abs(preview.tabDelta))}
                </>
              ) : (
                preview.alreadyOnTab > 0 && (
                  <> → taken off the tab, the bill carries the due</>
                )
              )}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button className="h-12 w-full" onClick={save} disabled={saving}>
            <ReceiptText className="size-5" /> Generate bill · {money(total)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
