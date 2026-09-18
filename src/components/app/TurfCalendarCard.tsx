import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "@/components/app/SectionHeading";
import { money } from "@/lib/biz";
import { cn, localDateStr } from "@/lib/utils";
import { useTurfBookings, type TurfBooking } from "@/lib/ops";
import { isFinancialBooking } from "@/lib/analytics";
import { parseMinutes } from "@/lib/time-slot-utils";
import { LayoutPart, LayoutParts } from "./LayoutSection";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const iso = localDateStr;

/**
 * Sort key for the day view: unknown/missing times sort first; midnight
 * ("12 AM") sorts last, since it's treated as the end of the business day,
 * not the start of the next one. `parseMinutes` itself must keep returning
 * literal 0 for midnight — other consumers (e.g. TurfTab's overlap check)
 * depend on 0 meaning 0 — so the 1440 substitution lives only here.
 */
const dayViewSortKey = (label: string | null) => {
  const mins = parseMinutes(label);
  if (mins === null) return -1;
  return mins === 0 ? 1440 : mins;
};

/** Month calendar of turf bookings: tap a day to see who is booked. */
export function TurfCalendarCard() {
  const { data: bookings = [] } = useTurfBookings();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string>(() => iso(new Date()));

  const byDay = useMemo(() => {
    const map = new Map<string, TurfBooking[]>();
    for (const b of bookings) {
      // dayTotal below sums these bookings' money, so this list must stay
      // limited to isFinancialBooking() rows or a merged booking's amount
      // would be double-counted against the bill it was rolled into.
      if (!isFinancialBooking(b)) continue;
      const key = b.booking_date.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return map;
  }, [bookings]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      iso(new Date(year, month, i + 1)),
    ),
  ];

  const monthLabel = cursor.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
  const dayBookings = byDay.get(selected) ?? [];
  const dayTotal = dayBookings.reduce(
    (s, b) => s + (Number(b.total_amount) || 0),
    0,
  );

  return (
    <Card>
      <CardContent className="space-y-4">
        <LayoutParts sectionId="turf.calendar" className="space-y-4">
          <LayoutPart id="turf.calendar.controls">
            <SectionHeading
              icon={CalendarDays}
              eyebrow="Calendar"
              title="Booking calendar"
              action={
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-8"
                    aria-label="Previous month"
                    onClick={() => setCursor(new Date(year, month - 1, 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="min-w-28 text-center text-sm font-medium tabular-nums">
                    {monthLabel}
                  </span>
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-8"
                    aria-label="Next month"
                    onClick={() => setCursor(new Date(year, month + 1, 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              }
            />
          </LayoutPart>

          <LayoutPart id="turf.calendar.grid" className="space-y-1">
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
              {WEEKDAYS.map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, i) => {
                if (!day) return <span key={`e${i}`} />;
                const list = byDay.get(day) ?? [];
                const isToday = day === iso(new Date());
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setSelected(day)}
                    className={cn(
                      "lift flex h-14 flex-col items-center justify-center rounded-lg border text-sm transition-colors",
                      list.length > 0 &&
                        "frost-soft border-primary/40 font-semibold",
                      isToday && "ring-1 ring-primary",
                      selected === day &&
                        "bg-primary text-primary-foreground shadow-md",
                    )}
                  >
                    <span>{Number(day.slice(8))}</span>
                    {list.length > 0 && (
                      <span className="text-[10px] opacity-80">
                        {list.length} slot{list.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </LayoutPart>

          <LayoutPart id="turf.calendar.day-detail">
            <div className="frost-well space-y-2 rounded-xl border p-3">
              <p className="text-sm font-medium">
                {/* `${date}T00:00:00` parses as LOCAL midnight; a bare "YYYY-MM-DD"
                parses as UTC midnight and reads back as the previous day
                anywhere west of UTC. */}
                {new Date(`${selected}T00:00:00`).toLocaleDateString("en-IN", {
                  weekday: "short",
                  day: "2-digit",
                  month: "short",
                })}
                {dayBookings.length > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {dayBookings.length} booking
                    {dayBookings.length > 1 ? "s" : ""} ·{" "}
                    <span className="stat-value text-foreground">
                      {money(dayTotal)}
                    </span>
                  </span>
                )}
              </p>
              {dayBookings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No bookings on this day.
                </p>
              ) : (
                dayBookings
                  .slice()
                  .sort(
                    (a, b) =>
                      dayViewSortKey(a.start_time) -
                      dayViewSortKey(b.start_time),
                  )
                  .map((b) => (
                    <div
                      key={b.id}
                      className="frost-soft grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        {b.start_time && b.end_time
                          ? `${b.start_time}–${b.end_time} · `
                          : ""}
                        {b.customer_name}
                      </span>
                      <span className="shrink-0 font-medium">
                        {money(b.total_amount)}
                      </span>
                    </div>
                  ))
              )}
            </div>
          </LayoutPart>
        </LayoutParts>
      </CardContent>
    </Card>
  );
}
