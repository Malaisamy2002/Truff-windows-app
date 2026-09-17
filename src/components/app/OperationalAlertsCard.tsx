import {
  AlertTriangle,
  CalendarClock,
  History,
  PackageX,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { goToTab } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { LayoutParts, LayoutPart } from "./LayoutSection";
import { SectionHeading } from "./SectionHeading";

export type NextBookingInfo = { label: string; sub: string; whenText: string };

type AlertRow = {
  id: string;
  icon: LucideIcon;
  text: string;
  sub?: string;
  tone: "warn" | "bad" | "info";
  actionLabel: string;
  tab: string;
};

/**
 * Compact "needs attention right now" strip for Home — deliberately just
 * four possible rows (next booking due soon, snacks running low, stale
 * Confirmed bookings, backup overdue) rather than separate cards, so it
 * stays scannable instead of adding more scroll. Renders nothing at all
 * when there is nothing to flag, same as the existing `home.report-ready` /
 * `home.insights` cards.
 */
export function OperationalAlertsCard({
  nextBooking,
  lowStockCount,
  staleBookingsCount,
  backupOverdue,
  lastBackupAt,
}: {
  /** Only passed in when a booking is due today or tomorrow — see
   *  `DashboardTab`'s `nextBookingInfo`; older/farther-out bookings don't
   *  belong in an "alerts" strip. */
  nextBooking: NextBookingInfo | null;
  lowStockCount: number;
  /** Bookings still marked Confirmed for a date that's already passed —
   *  see `DashboardTab`'s `staleBookingsCount`. */
  staleBookingsCount: number;
  backupOverdue: boolean;
  lastBackupAt: string | null;
}) {
  const rows: AlertRow[] = [];

  if (nextBooking) {
    rows.push({
      id: "next-booking",
      icon: CalendarClock,
      text: `${nextBooking.whenText}: ${nextBooking.label}`,
      sub: nextBooking.sub,
      tone: "info",
      actionLabel: "View",
      tab: "turf",
    });
  }
  if (lowStockCount > 0) {
    rows.push({
      id: "low-stock",
      icon: PackageX,
      text: `${lowStockCount} snack item${lowStockCount === 1 ? "" : "s"} running low`,
      tone: "warn",
      actionLabel: "Restock",
      tab: "snacks",
    });
  }
  if (staleBookingsCount > 0) {
    rows.push({
      id: "stale-bookings",
      icon: History,
      text: `${staleBookingsCount} past booking${staleBookingsCount === 1 ? "" : "s"} still marked Confirmed`,
      sub: "Mark them Completed or Cancelled to keep records tidy",
      tone: "warn",
      actionLabel: "Review",
      tab: "turf",
    });
  }
  if (backupOverdue) {
    rows.push({
      id: "backup",
      icon: ShieldAlert,
      text: lastBackupAt ? "Backup is overdue" : "You've never backed up",
      tone: "bad",
      actionLabel: "Back up",
      tab: "settings",
    });
  }

  if (rows.length === 0) return null;

  return (
    <section className="space-y-3">
      <LayoutParts sectionId="home.operational-alerts" className="space-y-3">
        <LayoutPart id="home.operational-alerts.heading">
          <SectionHeading
            eyebrow="NEEDS ATTENTION"
            title="Operational alerts"
            icon={AlertTriangle}
          />
        </LayoutPart>
        <LayoutPart id="home.operational-alerts.list">
          <Card className="frost">
            <CardContent className="space-y-2 p-4">
              {rows.map((r) => {
                const Icon = r.icon;
                return (
                  <div
                    key={r.id}
                    className="frost-soft flex flex-wrap items-center gap-3 rounded-xl border p-3"
                  >
                    <span
                      className={cn(
                        "grid size-9 shrink-0 place-items-center rounded-full",
                        r.tone === "bad" &&
                          "bg-destructive/10 text-destructive",
                        r.tone === "warn" && "bg-warning/15 text-warning",
                        r.tone === "info" && "bg-primary/10 text-primary",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.text}</p>
                      {r.sub && (
                        <p className="truncate text-xs text-muted-foreground">
                          {r.sub}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => goToTab(r.tab)}
                    >
                      {r.actionLabel}
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </LayoutPart>
      </LayoutParts>
    </section>
  );
}
