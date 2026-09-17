import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  CheckCircle2,
  History,
  Lock,
  PenLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { money, rupees } from "@/lib/money";
import {
  dayCloseVariance,
  useCloseDay,
  useDayCloseHistory,
  type DayClose,
} from "@/lib/day-close";

type Props = {
  /** IST calendar day being closed, e.g. "2026-09-16". */
  day: string;
  /** Live cashCollectedToday − cashExpensesToday from the dashboard. */
  expectedInDrawer: number;
  /** Existing close-out record for this day, if it's already been closed. */
  existing?: DayClose | undefined;
};

/**
 * The guided step DashboardTab's cash-drawer figure was missing: count the
 * till, compare it against the running "expected in drawer" number, log
 * anything that doesn't match, and mark the day closed. Re-opening on an
 * already-closed day pre-fills the previous count so a correction amends
 * the same record instead of creating a second one for the day (see
 * `closeDay()` in lib/day-close.ts).
 */
export function DayCloseDialog({ day, expectedInDrawer, existing }: Props) {
  const [open, setOpen] = useState(false);
  const [countedDraft, setCountedDraft] = useState("");
  const [note, setNote] = useState("");
  const close = useCloseDay();
  // Only fetched while the dialog is open on an already-closed day — no
  // point loading amendment history for a day that hasn't been closed yet.
  const { data: history = [] } = useDayCloseHistory(
    open && existing ? day : "",
  );

  useEffect(() => {
    if (!open) return;
    setCountedDraft(existing ? String(existing.countedCash) : "");
    setNote(existing?.note ?? "");
  }, [open, existing]);

  const counted = rupees(countedDraft);
  const hasCounted = countedDraft.trim() !== "";
  const variance = hasCounted ? dayCloseVariance(expectedInDrawer, counted) : 0;

  const save = () => {
    if (!hasCounted) return;
    close.mutate(
      { day, expectedInDrawer, countedCash: counted, note },
      {
        onSuccess: () => {
          toast.success(
            variance === 0
              ? "Day closed — till matched exactly"
              : `Day closed — ${variance > 0 ? "over" : "short"} by ${money(Math.abs(variance))}`,
          );
          setOpen(false);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {existing ? (
          <Button variant="outline" size="sm">
            <PenLine className="mr-1 h-4 w-4" /> Edit closing
          </Button>
        ) : (
          <Button size="sm">
            <Lock className="mr-1 h-4 w-4" /> Close day
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            {existing ? "Edit day closing" : "Close the day"}
          </DialogTitle>
          <DialogDescription>
            Count the cash actually in the drawer and enter it below. Expenses
            are assumed paid out of the drawer unless you track otherwise.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="frost-well rounded-xl p-3 text-sm">
            <span className="text-muted-foreground">Expected in drawer</span>
            <p className="stat-hero text-2xl">{money(expectedInDrawer)}</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="counted-cash" className="text-xs">
              Cash counted
            </Label>
            <Input
              id="counted-cash"
              inputMode="decimal"
              autoFocus
              value={countedDraft}
              onChange={(e) => setCountedDraft(e.target.value)}
              placeholder="e.g. 4150"
            />
          </div>

          {hasCounted && (
            <div
              className={cn(
                "rounded-lg border px-3 py-2 text-sm font-medium",
                variance === 0
                  ? "border-success/40 text-success"
                  : "border-destructive/40 text-destructive",
              )}
            >
              {variance === 0
                ? "Matches exactly"
                : `${variance > 0 ? "Over" : "Short"} by ${money(Math.abs(variance))}`}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="close-note" className="text-xs">
              Note (optional)
            </Label>
            <Textarea
              id="close-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. gave change for a torn note, missed logging an expense…"
              rows={2}
            />
          </div>

          {existing && (
            <p className="text-xs text-muted-foreground">
              Previously closed at{" "}
              {new Date(existing.closedAt).toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
              . Saving again amends this record — what it held before stays on
              the amendment log below.
            </p>
          )}

          {history.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto w-full justify-between px-2 py-1.5 text-xs text-muted-foreground"
                >
                  <span className="flex items-center gap-1.5">
                    <History className="h-3.5 w-3.5" />
                    {history.length === 1
                      ? "Amended once"
                      : `Amended ${history.length} times`}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1.5 px-2 pt-1">
                {history.map((h) => (
                  <div
                    key={h.id}
                    className="frost-well rounded-lg p-2 text-xs text-muted-foreground"
                  >
                    <span className="font-medium text-foreground">
                      {money(h.previousCountedCash)} counted
                    </span>{" "}
                    (
                    {h.previousVariance === 0
                      ? "matched"
                      : `${h.previousVariance > 0 ? "over" : "short"} by ${money(Math.abs(h.previousVariance))}`}
                    ) — replaced{" "}
                    {new Date(h.amendedAt).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {h.previousNote ? `. Note: "${h.previousNote}"` : ""}
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!hasCounted || close.isPending}>
            <CheckCircle2 className="mr-1 h-4 w-4" />
            {close.isPending ? "Saving…" : "Save & close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
