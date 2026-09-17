import type { LucideIcon } from "lucide-react";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

/**
 * One collapsible block inside the Settings accordion — a tap-to-expand
 * dropdown per section (Appearance, Pricing, Backup, …) instead of one long
 * scroll. `action` (e.g. a sort menu) renders next to the chevron, outside
 * the trigger's own click target, so tapping it doesn't also toggle the
 * section open/closed.
 */
export function SettingsSection({
  value,
  eyebrow,
  title,
  hint,
  icon: Icon,
  action,
  children,
  className,
}: {
  /** Unique key for this section — also what's saved to remember which
   * sections were left open across a refresh. */
  value: string;
  eyebrow?: string;
  title: string;
  hint?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <AccordionItem
      value={value}
      // Lets the first-run checklist (or anything else) scroll straight to
      // this card via document.getElementById — see FirstRunChecklistCard.
      id={`settings-section-${value}`}
      className={cn("frost overflow-hidden rounded-2xl border px-4", className)}
    >
      <div className="flex items-center gap-2">
        <AccordionTrigger className="flex-1 py-4 hover:no-underline">
          <div className="flex min-w-0 items-center gap-3">
            {Icon ? (
              <span className="frost-soft grid size-9 shrink-0 place-items-center rounded-xl border">
                <Icon className="size-4 text-primary" />
              </span>
            ) : null}
            <div className="min-w-0">
              {eyebrow ? (
                <p className="micro-label truncate">{eyebrow}</p>
              ) : null}
              <h2 className="page-title truncate">{title}</h2>
              {hint ? (
                <p className="truncate text-xs text-muted-foreground">{hint}</p>
              ) : null}
            </div>
          </div>
        </AccordionTrigger>
        {action ? (
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {action}
          </div>
        ) : null}
      </div>
      <AccordionContent className="pt-1">{children}</AccordionContent>
    </AccordionItem>
  );
}
