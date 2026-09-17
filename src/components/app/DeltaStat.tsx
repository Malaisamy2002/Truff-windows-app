import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small "% vs previous period" indicator with a direction arrow. */
export function DeltaStat({
  change,
  invert = false,
  label = "vs last month",
}: {
  change: number | null;
  invert?: boolean;
  label?: string;
}) {
  if (change === null)
    return <p className="text-[11px] text-muted-foreground">No {label} data</p>;

  const flat = Math.abs(change) < 0.05;
  const up = change > 0;
  const good = invert ? !up : up;
  const Icon = flat ? ArrowRight : up ? ArrowUpRight : ArrowDownRight;

  return (
    <p
      className={cn(
        "flex items-center gap-1 text-[11px] font-medium",
        flat
          ? "text-muted-foreground"
          : good
            ? "text-success"
            : "text-destructive",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {flat ? "0.0" : `${up ? "+" : ""}${change.toFixed(1)}`}% {label}
    </p>
  );
}
