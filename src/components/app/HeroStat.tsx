import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Tone = "primary" | "good" | "warn" | "bad";

const TONE_RING: Record<Tone, string> = {
  primary: "before:bg-primary",
  good: "before:bg-success",
  warn: "before:bg-warning",
  bad: "before:bg-destructive",
};

const TONE_TEXT: Record<Tone, string> = {
  primary: "text-foreground",
  good: "text-success",
  warn: "text-warning-foreground",
  bad: "text-destructive",
};

const TONE_ICON_WRAP: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary",
  good: "bg-success/10 text-success",
  warn: "bg-warning/15 text-warning-foreground",
  bad: "bg-destructive/10 text-destructive",
};

/** Large hero figure — reserved for the one or two numbers that matter most. */
export function HeroStat({
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
  footer,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: Tone;
  footer?: React.ReactNode;
}) {
  return (
    <Card
      className={cn(
        "lift relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-1",
        TONE_RING[tone],
      )}
    >
      <CardContent className="p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:justify-between">
          <p className="micro-label min-w-0 truncate">{label}</p>
          {Icon ? (
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-xl",
                TONE_ICON_WRAP[tone],
              )}
            >
              <Icon className="size-4" />
            </span>
          ) : null}
        </div>
        <p className={cn("stat-hero mt-3", TONE_TEXT[tone])}>{value}</p>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
        {footer ? <div className="mt-3">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}

/** Compact supporting figure for the demoted metric strip. */
export function MiniStat({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <Card className="frost-soft lift border-none p-0 shadow-none">
      <CardContent className="p-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 sm:flex sm:justify-between">
          <p className="micro-label min-w-0 truncate">{label}</p>
          {Icon ? (
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : null}
        </div>
        <p className="stat-value mt-1 truncate text-base leading-tight">
          {value}
        </p>
        {hint ? (
          <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
