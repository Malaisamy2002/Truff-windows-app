import { CalendarClock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "./SectionHeading";
import { money } from "@/lib/biz";
import { cn } from "@/lib/utils";
import type { OccupancyRow, TurfOccupancy } from "@/lib/analytics";

function Bars({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: OccupancyRow[];
  empty: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.hours));
  const shown = rows.filter((r) => r.hours > 0);
  return (
    <div className="space-y-2">
      <p className="micro-label">{title}</p>
      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-1.5">
          {rows
            .filter((r) => r.hours > 0)
            .map((r) => (
              <div key={r.key} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-xs text-muted-foreground">
                  {r.label}
                </span>
                <div className="h-4 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${max > 0 ? (r.hours / max) * 100 : 0}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {r.hours.toFixed(1)} hrs · {r.sharePct.toFixed(0)}%
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/**
 * The deep turf view for Reports: how full each weekday and each hour ran in
 * the selected month, what an average slot was worth, and what was lost to
 * cancelled or still-unpaid slots.
 */
export function TurfUsageDetailCard({
  occupancy,
}: {
  occupancy: TurfOccupancy;
}) {
  const tiles = [
    { label: "Bookings", value: String(occupancy.bookingCount) },
    { label: "Booked hours", value: occupancy.bookedHours.toFixed(1) },
    { label: "Average slot value", value: money(occupancy.avgSlotValue) },
    {
      label: "Average slot length",
      value: `${occupancy.avgSlotHours.toFixed(1)} hrs`,
    },
    {
      label: "Cancelled slots",
      value: `${occupancy.cancelled.count} · ${money(occupancy.cancelled.amount)}`,
      bad: occupancy.cancelled.count > 0,
    },
    {
      label: "Unpaid slots",
      value: `${occupancy.unpaid.count} · ${money(occupancy.unpaid.amount)}`,
      bad: occupancy.unpaid.count > 0,
    },
  ];

  const busiest =
    occupancy.busiestWeekday && occupancy.busiestHour
      ? `Busiest: ${occupancy.busiestWeekday.label} around ${occupancy.busiestHour.label}`
      : null;

  return (
    <section className="space-y-3">
      <SectionHeading
        eyebrow="TURF"
        title="Turf usage detail"
        {...(busiest ? { hint: busiest } : {})}
        icon={CalendarClock}
      />
      <Card className="frost">
        <CardContent className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            {tiles.map((t) => (
              <div key={t.label} className="frost-well rounded-xl p-3">
                <p className="micro-label">{t.label}</p>
                <p
                  className={cn(
                    "mt-1 text-sm font-semibold tabular-nums",
                    t.bad && "text-destructive",
                  )}
                >
                  {t.value}
                </p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Bars
              title="Occupancy by weekday"
              rows={occupancy.byWeekday}
              empty="No timed bookings this month."
            />
            <Bars
              title="Occupancy by hour"
              rows={occupancy.byHour}
              empty="No start/end times recorded this month."
            />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
