import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { money } from "@/lib/biz";
import { SectionHeading } from "./SectionHeading";

const MODE_COLORS: Record<string, string> = {
  Cash: "var(--chart-1)",
  UPI: "var(--chart-2)",
  Card: "var(--chart-3)",
  Pending: "var(--chart-4)",
  Other: "var(--chart-5)",
};

export function PaymentSplitCard({
  data,
  title = "Payment mode split",
  subtitle,
}: {
  data: { name: string; value: number }[];
  title?: string;
  subtitle?: string;
}) {
  const total = data.reduce((n, d) => n + d.value, 0);

  return (
    <section className="space-y-3">
      <SectionHeading
        eyebrow="PAYMENT MODES"
        title={title}
        {...(subtitle ? { hint: subtitle } : {})}
      />
      <Card className="frost">
        <CardContent className="space-y-3 pt-5">
          {total === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No payments recorded for this period.
            </p>
          ) : (
            <>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data}
                      dataKey="value"
                      nameKey="name"
                      outerRadius="75%"
                      innerRadius="45%"
                    >
                      {data.map((d) => (
                        <Cell
                          key={d.name}
                          fill={MODE_COLORS[d.name] ?? "var(--chart-5)"}
                        />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => money(v)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {data.map((d) => (
                  <div
                    key={d.name}
                    className="frost-soft lift rounded-xl border p-2.5"
                  >
                    <p className="micro-label">{d.name}</p>
                    <p className="stat-value text-sm">{money(d.value)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {((d.value / total) * 100).toFixed(1)}% of {money(total)}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
