import { Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "./SectionHeading";
import { money } from "@/lib/biz";
import { owedBy, type CustomerRanking } from "@/lib/analytics";
import type { CustomerLifetime } from "@/lib/data";

function List({
  title,
  rows,
}: {
  title: string;
  rows: {
    id: string;
    name: string;
    detail: string;
    value: string;
    bad?: boolean;
  }[];
}) {
  return (
    <div className="space-y-2">
      <p className="micro-label">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing to show yet.</p>
      ) : (
        rows.map((r) => (
          <div
            key={r.id}
            className="frost-soft flex items-center gap-2 rounded-xl border p-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {r.detail}
              </p>
            </div>
            <p
              className={
                r.bad
                  ? "text-sm font-bold text-destructive"
                  : "text-sm font-semibold"
              }
            >
              {r.value}
            </p>
          </div>
        ))
      )}
    </div>
  );
}

/** Who is worth keeping happy, who visits most, and who still owes. */
export function TopCustomersCard({
  ranking,
}: {
  ranking: CustomerRanking<CustomerLifetime>;
}) {
  const { topSpenders, mostFrequent, owing } = ranking;

  return (
    <section className="space-y-3">
      <SectionHeading eyebrow="CUSTOMERS" title="Best customers" icon={Users} />
      <Card className="frost">
        <CardContent className="grid gap-4 p-4 lg:grid-cols-3">
          <List
            title="Top spenders (lifetime)"
            rows={topSpenders.map((c) => ({
              id: `spend-${c.id}`,
              name: c.name,
              detail: `${c.bookingsCount} booking${c.bookingsCount === 1 ? "" : "s"}`,
              value: money(c.totalSpend),
            }))}
          />
          <List
            title="Most frequent visitors"
            rows={mostFrequent.map((c) => ({
              id: `freq-${c.id}`,
              name: c.name,
              detail: `avg ${money(c.avgBookingValue)} per booking`,
              value: `${c.bookingsCount}`,
            }))}
          />
          <List
            title="Still owes"
            rows={owing.map((c) => ({
              id: `due-${c.id}`,
              name: c.name,
              detail: c.phone ?? "No phone on file",
              value: money(owedBy(c)),
              bad: true,
            }))}
          />
        </CardContent>
      </Card>
    </section>
  );
}
