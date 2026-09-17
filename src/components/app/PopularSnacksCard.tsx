import { useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "@/components/app/SectionHeading";
import { LayoutPart, LayoutParts } from "./LayoutSection";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { money } from "@/lib/biz";
import { useSnackSales } from "@/lib/ops";
import { localDateStr } from "@/lib/utils";

type Range = "week" | "month";

const since = (range: Range) => {
  const d = new Date();
  d.setDate(d.getDate() - (range === "week" ? 7 : 30));
  return localDateStr(d);
};

/** Top 5 selling snacks by quantity for the last 7 or 30 days. */
export function PopularSnacksCard() {
  const { data: sales = [] } = useSnackSales();
  const [range, setRange] = useState<Range>("week");

  const top = useMemo(() => {
    const from = since(range);
    const byItem = new Map<
      string,
      { name: string; qty: number; revenue: number }
    >();
    for (const s of sales) {
      if (s.sale_date < from) continue;
      for (const line of s.items ?? []) {
        const row = byItem.get(line.item_name) ?? {
          name: line.item_name,
          qty: 0,
          revenue: 0,
        };
        row.qty += Number(line.qty) || 0;
        row.revenue += Number(line.amount) || 0;
        byItem.set(line.item_name, row);
      }
    }
    return [...byItem.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
  }, [sales, range]);

  return (
    <Card>
      <CardContent className="space-y-4">
        <LayoutParts sectionId="snacks.popular" className="space-y-4">
          <LayoutPart id="snacks.popular.heading">
            <SectionHeading
              icon={TrendingUp}
              eyebrow="Insights"
              title="Popular items"
              action={
                <div className="frost-soft flex gap-1 rounded-lg border p-1">
                  {(["week", "month"] as Range[]).map((r) => (
                    <Button
                      key={r}
                      size="sm"
                      variant={range === r ? "default" : "ghost"}
                      className="h-8"
                      onClick={() => setRange(r)}
                    >
                      {r === "week" ? "7 days" : "30 days"}
                    </Button>
                  ))}
                </div>
              }
            />
          </LayoutPart>
          <LayoutPart id="snacks.popular.chart">
            {top.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No snack sales in this period yet.
              </p>
            ) : (
              <ChartContainer
                className="h-56 w-full"
                config={{
                  qty: { label: "Qty sold", color: "var(--color-snacks)" },
                }}
              >
                <ResponsiveContainer>
                  <BarChart
                    data={top}
                    layout="vertical"
                    margin={{ left: 8, right: 16 }}
                  >
                    <defs>
                      {/* Snack-hue gradient for the "most sold" bars. Previously
                      these fell back to solid black: the fill was wrapping
                      --primary (an oklch() color) inside hsl(...), which is
                      invalid CSS and silently failed. */}
                      <linearGradient
                        id="popularSnacksGradient"
                        x1="0"
                        y1="0"
                        x2="1"
                        y2="0"
                      >
                        <stop
                          offset="0%"
                          stopColor="var(--color-snacks)"
                          stopOpacity={0.35}
                        />
                        <stop offset="100%" stopColor="var(--color-snacks)" />
                      </linearGradient>
                    </defs>
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={110}
                      tickLine={false}
                      axisLine={false}
                      className="text-xs"
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value, _n, item) => (
                            <span>
                              {value} sold ·{" "}
                              {money(Number(item?.payload?.revenue) || 0)}
                            </span>
                          )}
                        />
                      }
                    />
                    <Bar dataKey="qty" radius={6}>
                      {top.map((row) => (
                        <Cell
                          key={row.name}
                          fill="url(#popularSnacksGradient)"
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}
          </LayoutPart>
        </LayoutParts>
      </CardContent>
    </Card>
  );
}
