import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePersistedState } from "@/lib/ui-prefs";

/**
 * Collapsible wrapper for the long record lists (bills, dues, snack sales,
 * expenses, bookings, stock, customers). Closed by default so a screen opens
 * short and tidy; the open/closed choice is remembered per list via
 * `ks:ui:list:<storageKey>`.
 */
export function ListDisclosure({
  storageKey,
  label,
  count,
  hint,
  defaultOpen = false,
  className,
  children,
}: {
  storageKey: string;
  label: string;
  count?: number;
  hint?: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = usePersistedState<boolean>(
    `list:${storageKey}`,
    defaultOpen,
    (v) => typeof v === "boolean",
  );

  return (
    <div className={cn("space-y-3", className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="frost-soft flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronDown
            className={cn(
              "size-4 shrink-0 transition-transform",
              !open && "-rotate-90",
            )}
          />
          <span className="truncate text-sm font-medium">{label}</span>
          {typeof count === "number" && (
            <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              {count}
            </span>
          )}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {hint ?? (open ? "Hide" : "Show")}
        </span>
      </button>
      {open && <div className="space-y-3">{children}</div>}
    </div>
  );
}
