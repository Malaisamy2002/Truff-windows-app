import { useMemo, useState, type TouchEvent as ReactTouchEvent } from "react";
import { CalendarIcon, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn, localDateStr } from "@/lib/utils";
import {
  DAY_PARTS,
  type DayPartId,
  SLOT_INTERVALS,
  minuteLabel,
  rangeLabel,
  durationLabel,
} from "@/lib/time-slot-utils";

const iso = localDateStr;

const startOfWeek = (dateStr: string) => {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = (d.getDay() + 6) % 7; // Monday first
  d.setDate(d.getDate() - day);
  return d;
};

type Props = {
  date: string;
  onDateChange: (date: string) => void;
  courts: number;
  onCourtsChange: (courts: number) => void;
  dayPart: DayPartId;
  onDayPartChange: (part: DayPartId) => void;
  interval: number;
  onIntervalChange: (mins: number) => void;
  /** Slot durations available for the selected rate; defaults to all. */
  allowedIntervals?: readonly number[];
  /** Selected slot start times in minutes-from-midnight. */
  selected: number[];
  onToggleSlot: (mins: number) => void;
  bookedSlots: number[];
  /** Venue's total court count. Only >1 turns on the per-slot free-count detail. */
  totalCourts?: number;
  /** minute -> courts still free at that minute. Omit to keep the plain booked/free grid. */
  freeCourtsBySlot?: Map<number, number>;
};

export function TimeSlotPicker({
  date,
  onDateChange,
  courts,
  onCourtsChange,
  dayPart,
  onDayPartChange,
  interval,
  onIntervalChange,
  allowedIntervals,
  selected,
  onToggleSlot,
  bookedSlots,
  totalCourts,
  freeCourtsBySlot,
}: Props) {
  // Only worth surfacing on multi-court venues — a single-court venue's
  // "N of M free" would always just repeat the booked/free state already
  // shown by the slot's disabled styling.
  const showCourtCounts = (totalCourts ?? 1) > 1;
  const [pickerOpen, setPickerOpen] = useState(false);
  const week = useMemo(() => {
    const start = startOfWeek(date);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [date]);

  const todayIso = iso(new Date());
  const part = DAY_PARTS.find((p) => p.id === dayPart) ?? DAY_PARTS[0];
  const slots = Array.from(
    { length: ((part.to - part.from) * 60) / interval },
    (_, i) => part.from * 60 + i * interval,
  );
  const booked = new Set(bookedSlots);

  const totalMins = selected.length * interval;
  const endBoundary =
    selected.length > 0 ? Math.max(...selected) + interval : null;

  const partIndex = DAY_PARTS.findIndex((p) => p.id === part.id);
  const goPart = (dir: 1 | -1) => {
    const next =
      DAY_PARTS[(partIndex + dir + DAY_PARTS.length) % DAY_PARTS.length]!;
    onDayPartChange(next.id);
  };
  let touchX = 0;
  const onTouchStart = (e: ReactTouchEvent) => {
    touchX = e.changedTouches[0]!.clientX;
  };
  const onTouchEnd = (e: ReactTouchEvent) => {
    const dx = e.changedTouches[0]!.clientX - touchX;
    if (Math.abs(dx) > 50) goPart(dx < 0 ? 1 : -1);
  };

  return (
    <div className="frost-well space-y-4 rounded-2xl border p-3 sm:p-4">
      {/* Week strip */}
      <div className="flex items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-7 gap-1">
          {week.map((d) => {
            const value = iso(d);
            const active = value === date;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onDateChange(value)}
                className={cn(
                  "lift flex flex-col items-center rounded-lg py-1.5 text-[11px] font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "frost-soft border text-muted-foreground hover:text-foreground",
                )}
              >
                <span>
                  {["M", "T", "W", "T", "F", "S", "S"][(d.getDay() + 6) % 7]}
                </span>
                <span className={cn("text-sm", active && "font-bold")}>
                  {d.getDate()}
                </span>
              </button>
            );
          })}
        </div>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="shrink-0"
              aria-label="Pick a date"
            >
              <CalendarIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={new Date(`${date}T00:00:00`)}
              onSelect={(d) => {
                if (!d) return;
                onDateChange(iso(d));
                setPickerOpen(false);
              }}
              autoFocus
            />
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => onDateChange(todayIso)}
        >
          Today
        </Button>
      </div>

      {/* Courts stepper */}
      <div className="frost-soft flex items-center justify-between rounded-xl border px-3 py-2.5">
        <Label className="micro-label">No. of courts</Label>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-7"
            aria-label="Decrease courts"
            onClick={() => onCourtsChange(Math.max(1, courts - 1))}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span className="w-6 text-center text-sm font-semibold">
            {courts}
          </span>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-7"
            aria-label="Increase courts"
            onClick={() => onCourtsChange(Math.min(10, courts + 1))}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Slot duration toggle */}
      <div className="space-y-1.5">
        <Label className="micro-label">Slot duration</Label>
        <div
          className="grid gap-1 rounded-xl bg-muted/70 p-1"
          style={{
            gridTemplateColumns: `repeat(${SLOT_INTERVALS.filter((m) => !allowedIntervals || allowedIntervals.includes(m)).length}, minmax(0, 1fr))`,
          }}
        >
          {SLOT_INTERVALS.filter(
            (m) => !allowedIntervals || allowedIntervals.includes(m),
          ).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onIntervalChange(m)}
              className={cn(
                "rounded-lg py-1.5 text-[11px] font-medium transition-colors",
                m === interval
                  ? "bg-card text-primary shadow-sm ring-1 ring-primary/30"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === 60 ? "1 hr" : `${m} min`}
            </button>
          ))}
        </div>
      </div>

      {/* Day-part toggle */}
      {/* One column per day-part (5) — a fixed 4-col grid used to wrap
          "Night" onto a lonely second row. Icon-only labels on very
          narrow phones so the row still fits. */}
      <div
        className="grid gap-1 rounded-xl bg-muted/70 p-1"
        style={{
          gridTemplateColumns: `repeat(${DAY_PARTS.length}, minmax(0, 1fr))`,
        }}
      >
        {DAY_PARTS.map((p) => {
          const Icon = p.icon;
          const active = p.id === dayPart;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onDayPartChange(p.id)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition-colors",
                active
                  ? "bg-card text-primary shadow-sm ring-1 ring-primary/30"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden truncate min-[390px]:inline sm:inline">
                {p.label}
              </span>
              <span className="truncate min-[390px]:hidden sm:hidden">
                {p.label.split(" ")[0]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Availability strip */}
      <div className="frost-soft space-y-1.5 rounded-lg border p-2.5">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {slots.filter((m) => !booked.has(m)).length} free ·{" "}
            {slots.filter((m) => booked.has(m)).length} booked
          </span>
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-success" />
              free
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-destructive" />
              booked
            </span>
          </span>
        </div>
        {/* Purely decorative — the same free/booked state is already
            conveyed with a text label in the legend above and, in the
            interactive slot grid below, via `disabled` + strikethrough
            text (not color alone). Hidden from assistive tech so a
            screen reader doesn't read out an unlabeled row of colored
            segments with no information a sighted user gets that isn't
            already announced elsewhere. */}
        <div
          aria-hidden="true"
          className="flex h-2 gap-0.5 overflow-hidden rounded-full"
        >
          {slots.map((m) => (
            <span
              key={m}
              title={`${minuteLabel(m, interval < 60)} — ${booked.has(m) ? "booked" : selected.includes(m) ? "selected" : "free"}`}
              className={cn(
                "flex-1",
                booked.has(m)
                  ? "bg-destructive"
                  : selected.includes(m)
                    ? "bg-primary"
                    : "bg-success/60",
              )}
            />
          ))}
        </div>
      </div>

      {/* Slot grid */}
      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={cn(
          "grid gap-2",
          interval <= 30
            ? "grid-cols-2 min-[420px]:grid-cols-4"
            : "grid-cols-2 min-[420px]:grid-cols-3",
        )}
      >
        {slots.map((m) => {
          const isBooked = booked.has(m);
          const isSelected = selected.includes(m);
          const isEnd = !isSelected && endBoundary === m;
          const freeCourts = freeCourtsBySlot?.get(m);
          return (
            <button
              key={m}
              type="button"
              disabled={isBooked}
              onClick={() => onToggleSlot(m)}
              className={cn(
                "relative rounded-lg border py-2 text-xs font-medium transition-all",
                isBooked &&
                  "cursor-not-allowed bg-muted text-muted-foreground line-through",
                !isBooked &&
                  isSelected &&
                  "border-primary bg-primary text-primary-foreground shadow-md scale-[1.03]",
                !isBooked &&
                  isEnd &&
                  "border-2 border-dashed border-primary bg-primary/10 text-primary",
                !isBooked &&
                  !isSelected &&
                  !isEnd &&
                  "frost-soft hover:border-primary hover:text-primary",
              )}
            >
              {minuteLabel(m, interval < 60)}
              {isEnd && (
                <span className="block text-[9px] font-semibold uppercase opacity-70">
                  ends
                </span>
              )}
              {/* "N of M courts free" — only for multi-court venues, and only
                  on slots where it isn't already obvious (skip on the "ends"
                  boundary marker, which has its own label to show). */}
              {showCourtCounts && !isEnd && freeCourts !== undefined && (
                <span className="block text-[9px] font-normal opacity-70">
                  {isBooked ? "full" : `${freeCourts}/${totalCourts} free`}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Pagination dots */}
      <div className="flex justify-center gap-1.5">
        {DAY_PARTS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-label={p.label}
            onClick={() => onDayPartChange(p.id)}
            className={cn(
              "h-1.5 rounded-full transition-all",
              p.id === dayPart
                ? "w-4 bg-primary"
                : "w-1.5 bg-muted-foreground/30",
            )}
          />
        ))}
      </div>

      <p className="frost-well rounded-lg border py-2 text-center text-xs text-muted-foreground">
        {selected.length > 0
          ? `${rangeLabel(selected, interval)} · ${durationLabel(totalMins)} × ${courts} court${courts > 1 ? "s" : ""}`
          : "Tap a start slot, then an end slot"}
      </p>
    </div>
  );
}
