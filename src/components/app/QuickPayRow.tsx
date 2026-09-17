import { useState } from "react";
import { Banknote, Smartphone, IndianRupee } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { billGrossTotal, money, type Bill } from "@/lib/biz";
import { useUpdateBill } from "@/lib/data";
import { billDue } from "@/lib/dues";
import { rupees } from "@/lib/money";
import { useTabEntries } from "@/lib/tabs";

/** One-tap payment shortcuts and partial payment entry for a single bill. */
export function QuickPayRow({ bill }: { bill: Bill }) {
  const updateBill = useUpdateBill();
  const [part, setPart] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: tabEntries = [] } = useTabEntries();
  const gross = billGrossTotal(bill);
  // What this bill still owes ON ITS OWN: anything already pushed onto the
  // customer's running tab (or a bill saved "On tab") belongs to the tab
  // ledger, so collecting it here too would take the same rupee twice.
  const due = billDue(bill, tabEntries);
  const paidSoFar = rupees(bill.amount_paid);

  const payFull = async (mode: "Cash" | "UPI") => {
    if (busy) return;
    setBusy(true);
    try {
      await updateBill.mutateAsync({
        id: bill.id,
        status: "paid",
        amount_paid: Math.min(gross, paidSoFar + due),
        payment_mode: mode,
      });
      toast.success(`Paid via ${mode}`);
    } finally {
      setBusy(false);
    }
  };

  const payPart = async () => {
    if (busy) return;
    // Whole rupee — matches every other payable amount in the app (see
    // money.ts); the field is free-text, so a typed "50.5" would otherwise
    // save a fractional amount_paid.
    const amt = rupees(Number(part));
    if (!amt || amt <= 0) {
      toast.error("Enter an amount");
      return;
    }
    setBusy(true);
    try {
      const applied = Math.min(amt, due);
      const paid = Math.min(gross, paidSoFar + applied);
      await updateBill.mutateAsync({
        id: bill.id,
        status: applied >= due ? "paid" : "partial",
        amount_paid: paid,
      });
      setPart("");
      toast.success(
        `Recorded ${money(applied)} · Due ${money(Math.max(0, due - applied))}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {due > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            className="lift h-12"
            disabled={busy}
            onClick={() => payFull("Cash")}
          >
            <Banknote className="size-4" /> Paid · Cash
          </Button>
          <Button
            className="lift h-12"
            variant="secondary"
            disabled={busy}
            onClick={() => payFull("UPI")}
          >
            <Smartphone className="size-4" /> Paid · UPI
          </Button>
        </div>
      )}
      {due > 0 && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <IndianRupee className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-12 pl-9"
              type="number"
              inputMode="decimal"
              placeholder={`Part payment (due ${due})`}
              value={part}
              onChange={(e) => setPart(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            className="h-12"
            disabled={busy}
            onClick={payPart}
          >
            Record
          </Button>
        </div>
      )}
    </div>
  );
}
