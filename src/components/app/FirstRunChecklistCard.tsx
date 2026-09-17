import {
  CheckCircle2,
  Circle,
  ClipboardList,
  ChevronRight,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useFirstRunChecklist } from "@/lib/first-run";
import { goToTab } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Section 6's first-run checklist: Business details → Turf rates → Courts &
 * durations → Snack catalog → Payment methods → Printer → Backup → First
 * test booking. Lives at the top of Settings, above the search box — see
 * lib/first-run.ts for why every row is a plain owner-ticked checkbox rather
 * than inferred from data.
 *
 * `onOpenSection` lets Settings expand + scroll to the right accordion card;
 * the one cross-tab step ("First test booking") uses the existing
 * `goToTab()` nav event directly instead, same as QuickActionsCard.
 */
export function FirstRunChecklistCard({
  onOpenSection,
}: {
  onOpenSection: (sectionValue: string) => void;
}) {
  const { steps, doneSet, toggle, percent, dismissed, setDismissed } =
    useFirstRunChecklist();

  if (dismissed) {
    return (
      <button
        type="button"
        onClick={() => setDismissed(false)}
        className="frost-soft flex w-full items-center justify-between gap-2 rounded-2xl border p-3 text-left text-sm text-muted-foreground hover:text-foreground"
      >
        <span className="flex items-center gap-2">
          <ClipboardList className="size-4" /> Setup checklist ({percent}%
          complete)
        </span>
        <ChevronRight className="size-4" />
      </button>
    );
  }

  return (
    <Card className="frost border-primary/30">
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="frost-soft grid size-9 shrink-0 place-items-center rounded-xl border">
              <ClipboardList className="size-4 text-primary" />
            </span>
            <div className="min-w-0">
              <p className="micro-label">GETTING STARTED</p>
              <h2 className="page-title truncate">Setup checklist</h2>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Hide checklist"
            title="Hide — you can reopen it any time"
            onClick={() => setDismissed(true)}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {doneSet.size} of {steps.length} done
            </span>
            <span>{percent}%</span>
          </div>
          <Progress value={percent} />
        </div>

        <div className="space-y-1">
          {steps.map((step) => {
            const done = doneSet.has(step.id);
            return (
              <div
                key={step.id}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-2.5",
                  done ? "frost-well opacity-70" : "frost-soft",
                )}
              >
                <button
                  type="button"
                  aria-label={
                    done
                      ? `Mark ${step.title} not done`
                      : `Mark ${step.title} done`
                  }
                  onClick={() => toggle(step.id)}
                  className="shrink-0"
                >
                  {done ? (
                    <CheckCircle2 className="size-5 text-success" />
                  ) : (
                    <Circle className="size-5 text-muted-foreground" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      done && "line-through decoration-muted-foreground/50",
                    )}
                  >
                    {step.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {step.description}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() =>
                    step.kind === "goto-tab"
                      ? goToTab(step.tab)
                      : onOpenSection(step.sectionValue)
                  }
                >
                  Open
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
