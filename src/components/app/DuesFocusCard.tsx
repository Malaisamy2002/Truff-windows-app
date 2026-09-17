import { AlertCircle, MessageCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "./SectionHeading";
import { money } from "@/lib/biz";
import { cn } from "@/lib/utils";

export type DuesFocusRow = {
  key: string;
  label: string;
  sub: string;
  date: string;
  due: number;
  phone: string | null;
};

export type DuesFocusBucket = {
  id: string;
  label: string;
  total: number;
  count: number;
  tone?: "bad" | "normal";
};

/**
 * Replaces the old payment-mode pie on Home: the same screen real estate now
 * answers "who owes me money, and how old is it" — the one number this
 * business acts on daily. Cash vs online is still shown as plain figures in
 * the cash-drawer card, so nothing was lost by dropping the chart.
 */
export function DuesFocusCard({
  total,
  buckets,
  topDebtors,
  cashCollected,
  onlineCollected,
  onRemind,
}: {
  total: number;
  buckets: DuesFocusBucket[];
  topDebtors: DuesFocusRow[];
  cashCollected: number;
  onlineCollected: number;
  onRemind: (row: DuesFocusRow) => void;
}) {
  return (
    <section className="space-y-3">
      <SectionHeading
        eyebrow="MONEY OWED"
        title="Money owed to me"
        hint="Oldest money first"
        icon={AlertCircle}
      />
      <Card className="frost">
        <CardContent className="space-y-4 p-4">
          <div className="frost-well rounded-xl p-4">
            <p
              className={cn(
                "stat-hero",
                total > 0 ? "text-destructive" : "text-success",
              )}
            >
              {money(total)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Total outstanding across bills and turf bookings.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {buckets.map((b) => (
              <div
                key={b.id}
                className="frost-soft lift rounded-xl border p-2.5"
              >
                <p className="micro-label">{b.label}</p>
                <p
                  className={cn(
                    "stat-value text-sm",
                    b.tone === "bad" && b.total > 0 && "text-destructive",
                  )}
                >
                  {money(b.total)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {b.count} {b.count === 1 ? "entry" : "entries"}
                </p>
              </div>
            ))}
          </div>

          {topDebtors.length > 0 && (
            <div className="space-y-2">
              <p className="micro-label">Chase these first</p>
              {topDebtors.map((row) => (
                <div
                  key={row.key}
                  className="frost-soft flex items-center gap-2 rounded-xl border p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.sub}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-destructive">
                    {money(row.due)}
                  </p>
                  {row.phone && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={() => onRemind(row)}
                      aria-label={`Send WhatsApp reminder to ${row.label}`}
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Collected today — cash {money(cashCollected)} · online{" "}
            {money(onlineCollected)}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
