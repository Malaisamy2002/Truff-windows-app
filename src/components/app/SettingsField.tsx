import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * Shared settings layout primitives.
 *
 * Every settings field renders with the same shape — one label line, the
 * control, then a reserved slot for the small grey note — so neighbouring
 * fields stay on the same baseline even when only one of them has a hint.
 */

/** A titled block of related fields inside a settings card. */
export function SettingsGroup({
  title,
  hint,
  children,
  className,
}: {
  title?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {title ? (
        <div className="space-y-0.5">
          <p className="micro-label">{title}</p>
          {hint ? (
            <p className="text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Responsive field grid: one column on phones, two, then three on wider windows. */
export function SettingsGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Label + control + reserved hint line. */
export function SettingsField({
  label,
  hint,
  children,
  full,
  reserveHint = true,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  /** Span the whole grid row (textareas, long inputs). */
  full?: boolean;
  /** Keep the hint line's height even when there is no hint. */
  reserveHint?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5",
        full && "sm:col-span-2 xl:col-span-3",
        className,
      )}
    >
      <Label className="micro-label leading-4">{label}</Label>
      {children}
      {hint ? (
        <p className="text-xs leading-4 text-muted-foreground">{hint}</p>
      ) : reserveHint ? (
        <span aria-hidden className="hidden h-4 sm:block" />
      ) : null}
    </div>
  );
}

/** Full-width on/off row: text on the left, switch pinned right. Pass
 * `disabled` for a setting that has no effect on the current platform —
 * the row dims and the switch stops responding, so the hint text can
 * explain why instead of the control silently doing nothing when tapped. */
export function SettingsSwitchRow({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "frost-soft grid min-h-12 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-3 py-2.5",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint ? (
          <span className="block text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="shrink-0"
      />
    </label>
  );
}

/** Action row: stacked full-width buttons on phones, inline on desktop. */
export function SettingsActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center [&>*]:w-full sm:[&>*]:w-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}
