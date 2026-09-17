import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PieChart as PieIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "./SectionHeading";
import { money } from "@/lib/biz";
import { cn } from "@/lib/utils";

export type ProfitMixInput = {
  turf: number;
  snacks: number;
  bills: number;
  expenses: number;
  profit: number;
  subtitle?: string;
};

const SOURCE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-4)"];

/**
 * Replaces the payment-mode pie on Reports. Payment mode rarely changes a
 * decision; which part of the business earned the money — and what it cost —
 * does.
 */
export function ProfitMixCard({
  turf,
  snacks,
  bills,
  expenses,
  profit,
  subtitle,
}: ProfitMixInput) {
  const sources = [
    { name: "Turf", value: turf },
    { name: "Snacks", value: snacks },
    { name: "Bills", value: bills },
  ].filter((s) => s.value > 0);
  const revenue = turf + snacks + bills;
  const chart = [...sources, { name: "Expenses", value: expenses }];

  return (
    <section className="space-y-3">
      <SectionHeading
        eyebrow="PROFIT MIX"
        title="Where the profit came from"
        icon={PieIcon}
        {...(subtitle ? { hint: subtitle } : {})}
      />
      <Card className="frost">
        <CardContent className="space-y-3 pt-5">
          {revenue === 0 && expenses === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No income or spending recorded for this month yet.
            </p>
          ) : (
            <>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chart}
                    layout="vertical"
                    margin={{ left: 8, right: 16 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      opacity={0.2}
                      horizontal={false}
                    />
                    <XAxis type="number" fontSize={10} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={64}
                      fontSize={11}
                    />
                    <Tooltip formatter={(v: number) => money(v)} />
                    <Bar dataKey="value" radius={4}>
                      {chart.map((d, i) => (
                        <Cell
                          key={d.name}
                          fill={
                            d.name === "Expenses"
                              ? "var(--chart-3)"
                              : (SOURCE_COLORS[
                                  i % SOURCE_COLORS.length
                                ] as string)
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {sources.map((s) => (
                  <div
                    key={s.name}
                    className="frost-soft lift rounded-xl border p-2.5"
                  >
                    <p className="micro-label">{s.name}</p>
                    <p className="stat-value text-sm">{money(s.value)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {revenue > 0
                        ? ((s.value / revenue) * 100).toFixed(1)
                        : "0.0"}
                      % of income
                    </p>
                  </div>
                ))}
                <div className="frost-soft lift rounded-xl border p-2.5">
                  <p className="micro-label">Profit after costs</p>
                  <p
                    className={cn(
                      "stat-value text-sm",
                      profit < 0 && "text-destructive",
                    )}
                  >
                    {money(profit)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    after {money(expenses)} of spending
                  </p>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
