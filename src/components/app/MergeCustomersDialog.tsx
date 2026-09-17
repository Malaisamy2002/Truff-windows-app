import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Merge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { type CustomerRec, useMergeCustomers } from "@/lib/data";

type Props = {
  customers: CustomerRec[];
};

/**
 * Manual merge for customers the automatic dedupe can't catch — e.g. the same
 * person saved once as "Ravi" and once as "Ravi Kumar" with a different phone.
 * Pick who to keep, tick who gets absorbed into them, and edit the final
 * name/phone before confirming. All their bills, turf bookings and snack
 * sales get re-pointed to the kept identity.
 */
export function MergeCustomersDialog({ customers }: Props) {
  const [open, setOpen] = useState(false);
  const [keepId, setKeepId] = useState<string | null>(null);
  const [absorbIds, setAbsorbIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const merge = useMergeCustomers();

  const reset = () => {
    setKeepId(null);
    setAbsorbIds([]);
    setName("");
    setPhone("");
  };

  const selectKeep = (id: string) => {
    setKeepId(id);
    setAbsorbIds((ids) => ids.filter((x) => x !== id));
    const c = customers.find((c) => c.id === id);
    if (c) {
      setName(c.name);
      setPhone(c.phone ?? "");
    }
  };

  const toggleAbsorb = (id: string) => {
    if (id === keepId) return;
    setAbsorbIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  };

  const keep = useMemo(
    () => customers.find((c) => c.id === keepId) ?? null,
    [customers, keepId],
  );
  const absorb = useMemo(
    () => customers.filter((c) => absorbIds.includes(c.id)),
    [customers, absorbIds],
  );

  const canMerge = keep && absorb.length > 0 && name.trim().length > 0;

  const doMerge = () => {
    if (!keep || !canMerge) return;
    merge.mutate(
      { keep, absorb, finalName: name, finalPhone: phone.trim() || null },
      {
        onSuccess: () => {
          toast.success(
            `Merged ${absorb.length} customer${absorb.length > 1 ? "s" : ""} into ${name.trim()}`,
          );
          setOpen(false);
          reset();
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Merge className="mr-1 h-4 w-4" /> Merge customers
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge duplicate customers</DialogTitle>
          <DialogDescription>
            Pick the record to keep, tick the duplicates to fold into it, then
            confirm the final name/phone. Their bills, bookings and snack orders
            move over automatically.
          </DialogDescription>
        </DialogHeader>

        {customers.length < 2 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            You need at least two saved customers to merge.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">1. Keep this customer</Label>
              <RadioGroup value={keepId ?? ""} onValueChange={selectKeep}>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {customers.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 rounded-md p-1.5 text-sm hover:bg-muted"
                    >
                      <RadioGroupItem value={c.id} />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {c.phone || "—"}
                      </span>
                    </label>
                  ))}
                </div>
              </RadioGroup>
            </div>

            {keepId && (
              <div className="space-y-1">
                <Label className="text-xs">2. Fold these into it</Label>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {customers
                    .filter((c) => c.id !== keepId)
                    .map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-2 rounded-md p-1.5 text-sm hover:bg-muted"
                      >
                        <Checkbox
                          checked={absorbIds.includes(c.id)}
                          onCheckedChange={() => toggleAbsorb(c.id)}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {c.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {c.phone || "—"}
                        </span>
                      </label>
                    ))}
                </div>
              </div>
            )}

            {keepId && absorb.length > 0 && (
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-dashed p-3">
                <div className="col-span-2">
                  <Label className="text-xs">3. Final name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Final phone</Label>
                  <Input
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) =>
                      setPhone(e.target.value.replace(/\D/g, ""))
                    }
                    placeholder="10 digits"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!canMerge || merge.isPending} onClick={doMerge}>
            <Merge className="mr-1 h-4 w-4" /> Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
