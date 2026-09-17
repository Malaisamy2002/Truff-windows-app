import { useState } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  CheckCircle2,
  PlusCircle,
  RotateCcw,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDMY, money } from "@/lib/biz";
import {
  TAB_BUSINESSES,
  tabKey,
  useAddTabEntry,
  useCloseTab,
  useDeleteTabEntry,
  useReopenTab,
  useSettleAndCloseTab,
  useTabSummaries,
} from "@/lib/tabs";

import { ConfirmDeleteButton } from "./ConfirmDeleteButton";

type Props = {
  name: string;
  phone: string | null;
  /** Dues that already live on bills / turf bookings, shown for context only. */
  autoDue?: number;
};

/**
 * The running tab for one customer: add a due, record a payment, and close the
 * tab once it hits ₹0. Tab dues are separate from bill/booking balances so the
 * same amount is never owed twice — see lib/tabs.ts.
 */
export function CustomerTabCard({ name, phone, autoDue = 0 }: Props) {
  const summaries = useTabSummaries();
  const summary = summaries.get(tabKey(name, phone));
  const tab = summary?.tab ?? null;
  const entries = summary?.entries ?? [];
  const balance = summary?.balance ?? 0;

  const addEntry = useAddTabEntry();
  const delEntry = useDeleteTabEntry();
  const closeTab = useCloseTab();
  const settle = useSettleAndCloseTab();
  const reopen = useReopenTab();

  const [dueAmount, setDueAmount] = useState("");
  const [dueBusiness, setDueBusiness] = useState<string>("Turf");
  const [dueNote, setDueNote] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMode, setPayMode] = useState<"Cash" | "UPI">("Cash");

  const closed = tab?.status === "closed";

  const addDue = () => {
    addEntry.mutate(
      {
        name,
        phone,
        kind: "charge",
        business: dueBusiness,
        amount: Number(dueAmount),
        note: dueNote,
      },
      {
        onSuccess: () => {
          setDueAmount("");
          setDueNote("");
          toast.success("Due added to tab");
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const addPayment = () => {
    const amount = Number(payAmount);
    if (amount > balance) {
      toast.error(`Payment is more than the ${money(balance)} balance`);
      return;
    }
    addEntry.mutate(
      {
        name,
        phone,
        kind: "payment",
        business: "Shared",
        amount,
        note: "Payment received",
        payment_mode: payMode,
      },
      {
        onSuccess: () => {
          setPayAmount("");
          toast.success("Payment recorded");
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="micro-label flex items-center gap-1.5">
          <BookOpen className="size-3.5" /> Running tab
        </p>
        {tab && (
          <Badge
            variant={
              closed ? "outline" : balance > 0 ? "destructive" : "secondary"
            }
          >
            {closed
              ? "Closed"
              : balance > 0
                ? `Open · ${money(balance)}`
                : "Open · settled"}
          </Badge>
        )}
      </div>

      <div className="frost-soft space-y-3 rounded-xl border p-3">
        <div className="grid grid-cols-1 gap-2 text-center min-[420px]:grid-cols-3">
          <div>
            <p className="micro-label">Charged</p>
            <p className="stat-value text-sm">{money(summary?.charged ?? 0)}</p>
          </div>
          <div>
            <p className="micro-label">Paid</p>
            <p className="stat-value text-sm">{money(summary?.paid ?? 0)}</p>
          </div>
          <div>
            <p className="micro-label">Balance</p>
            <p
              className={
                balance > 0
                  ? "stat-value text-sm text-destructive"
                  : "stat-value text-sm"
              }
            >
              {money(balance)}
            </p>
          </div>
        </div>

        {!closed && (
          <>
            <div className="grid gap-2 md:grid-cols-[6rem_7rem_1fr_auto] md:items-end">
              <div className="space-y-1">
                <Label className="micro-label">Add due</Label>
                <Input
                  inputMode="decimal"
                  value={dueAmount}
                  onChange={(e) => setDueAmount(e.target.value)}
                  placeholder="₹0"
                />
              </div>
              <div className="space-y-1">
                <Label className="micro-label">For</Label>
                <Select value={dueBusiness} onValueChange={setDueBusiness}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TAB_BUSINESSES.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="micro-label">Note</Label>
                <Input
                  value={dueNote}
                  onChange={(e) => setDueNote(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <Button
                variant="outline"
                onClick={addDue}
                disabled={addEntry.isPending}
              >
                <PlusCircle className="mr-1 size-4" /> Add
              </Button>
            </div>

            <div className="grid gap-2 md:grid-cols-[6rem_7rem_auto_1fr] md:items-end">
              <div className="space-y-1">
                <Label className="micro-label">Payment</Label>
                <Input
                  inputMode="decimal"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="₹0"
                />
              </div>
              <div className="space-y-1">
                <Label className="micro-label">Via</Label>
                <Select
                  value={payMode}
                  onValueChange={(v) => setPayMode(v as "Cash" | "UPI")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Cash">Cash</SelectItem>
                    <SelectItem value="UPI">UPI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={addPayment}
                disabled={balance <= 0 || addEntry.isPending}
              >
                <Wallet className="mr-1 size-4" /> Collect
              </Button>
              <Button
                variant="outline"
                disabled={!payAmount && balance <= 0}
                onClick={() => setPayAmount(String(balance))}
              >
                Pay full {money(balance)}
              </Button>
            </div>
          </>
        )}

        {entries.length === 0 ? (
          <p className="px-1 py-1 text-xs text-muted-foreground">
            No tab activity yet. Add a due above, or bill a snack order as "On
            tab".
          </p>
        ) : (
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {entries.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1 text-sm"
              >
                <span className="min-w-0 truncate">
                  {formatDMY(e.entry_date)}
                  <span className="text-muted-foreground">
                    {" · "}
                    {e.kind === "charge" ? `Due · ${e.business}` : "Payment"}
                    {e.kind === "payment" && e.payment_mode
                      ? ` · ${e.payment_mode}`
                      : ""}
                    {e.note ? ` · ${e.note}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span
                    className={
                      e.kind === "charge"
                        ? "stat-value text-sm text-destructive"
                        : "stat-value text-sm"
                    }
                  >
                    {e.kind === "charge" ? "+" : "−"}
                    {money(e.amount)}
                  </span>
                  {!closed && (
                    <ConfirmDeleteButton
                      size="sm"
                      ariaLabel="Remove entry"
                      title="Remove this entry?"
                      description={`This removes the ${
                        e.kind === "charge" ? "charge" : "payment"
                      } of ${money(e.amount)} from ${name}'s tab — the balance above will update immediately. This can't be undone.`}
                      onConfirm={() =>
                        delEntry.mutate(e.id, {
                          onSuccess: () => toast.success("Entry removed"),
                        })
                      }
                    />
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        {tab && !closed && (
          <div className="flex flex-wrap gap-2">
            <Button
              className="flex-1"
              disabled={balance > 0 || closeTab.isPending}
              onClick={() =>
                closeTab.mutate(tab.id, {
                  onSuccess: () => toast.success("Tab closed — fully paid"),
                  onError: (err) => toast.error(err.message),
                })
              }
            >
              <CheckCircle2 className="mr-1 size-4" /> Close tab
            </Button>
            {balance > 0 && (
              <Button
                variant="outline"
                className="flex-1"
                disabled={settle.isPending}
                onClick={() =>
                  settle.mutate(
                    { tabId: tab.id, payment_mode: payMode },
                    {
                      onSuccess: () =>
                        toast.success(`Settled via ${payMode} and closed`),
                      onError: (err) => toast.error(err.message),
                    },
                  )
                }
              >
                Settle {money(balance)} &amp; close
              </Button>
            )}
          </div>
        )}

        {tab && closed && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              reopen.mutate(tab.id, {
                onSuccess: () => toast.success("Tab reopened"),
              })
            }
          >
            <RotateCcw className="mr-1 size-4" /> Reopen tab
          </Button>
        )}

        {autoDue > 0 && (
          <p className="text-xs text-muted-foreground">
            Plus {money(autoDue)} pending on bills / turf bookings — collect
            that from the Turf and Bills tabs so it isn't counted twice here.
          </p>
        )}
      </div>
    </div>
  );
}
