import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Frosted section heading used to group content inside every tab:
 * mono micro-label, display title, optional hint and right-side action.
 */
export function SectionHeading({
  eyebrow,
  title,
  hint,
  icon: Icon,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  hint?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {Icon ? (
          <span className="frost-soft grid size-9 shrink-0 place-items-center rounded-xl border">
            <Icon className="size-4 text-primary" />
          </span>
        ) : null}
        <div className="min-w-0">
          {eyebrow ? <p className="micro-label truncate">{eyebrow}</p> : null}
          <h2 className="page-title line-clamp-2">{title}</h2>
          {hint ? (
            <p className="line-clamp-2 text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
