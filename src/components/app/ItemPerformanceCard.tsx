import { Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "./SectionHeading";
import { money } from "@/lib/biz";
import type { ItemPerformance, ItemPerformanceRow } from "@/lib/analytics";

function Column({
  title,
  rows,
  value,
  detail,
  muted,
}: {
  title: string;
  rows: ItemPerformanceRow[];
  value: (r: ItemPerformanceRow) => string;
  detail: (r: ItemPerformanceRow) => string;
  muted?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="micro-label">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No snack sales this month.
        </p>
      ) : (
        rows.map((r) => (
          <div
            key={r.name}
            className="frost-soft flex items-center gap-2 rounded-xl border p-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {detail(r)}
              </p>
            </div>
            <p
              className={
                muted
                  ? "text-sm font-semibold text-muted-foreground"
                  : "text-sm font-semibold"
              }
            >
              {value(r)}
            </p>
          </div>
        ))
      )}
    </div>
  );
}

/** Which snacks earn their shelf space, and which ones don't. */
export function ItemPerformanceCard({
  performance,
}: {
  performance: ItemPerformance;
}) {
  return (
    <section className="space-y-3">
      <SectionHeading
        eyebrow="SNACKS"
        title="Best & slow items"
        icon={Sparkles}
      />
      <Card className="frost">
        <CardContent className="grid gap-4 p-4 lg:grid-cols-3">
          <Column
            title="Top snacks by revenue"
            rows={performance.topByRevenue}
            value={(r) => money(r.revenue)}
            detail={(r) => `${r.qty} sold`}
          />
          <Column
            title="Top snacks by profit"
            rows={performance.topByProfit}
            value={(r) => money(r.profit)}
            detail={(r) => `${r.marginPct.toFixed(0)}% margin`}
          />
          <Column
            title="Slow movers"
            rows={performance.slowMovers}
            value={(r) => money(r.revenue)}
            detail={(r) => `only ${r.qty} sold`}
            muted
          />
        </CardContent>
      </Card>
    </section>
  );
}
