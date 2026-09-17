import { useMemo } from "react";
import {
  CalendarDays,
  IndianRupee,
  ReceiptText,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "@/components/app/SectionHeading";
import { LayoutPart, LayoutParts } from "./LayoutSection";
import { money } from "@/lib/biz";
import { useBills } from "@/lib/data";
import { useSnackSales, useTurfBookings } from "@/lib/ops";
import { dayKey, isFinancialBooking, statsForDay } from "@/lib/analytics";
import { isFinancialSale } from "@/lib/dues";
import { useTabEntries } from "@/lib/tabs";
import { localDateStr } from "@/lib/utils";
import { cn } from "@/lib/utils";

const todayISO = () => localDateStr();

/** Compact "how did today go" card shown at the top of the Bills tab. */
export function TodaySummaryCard() {
  const { data: bills = [] } = useBills();
  const { data: bookings = [] } = useTurfBookings();
  const { data: sales = [] } = useSnackSales();
  const { data: tabEntries = [] } = useTabEntries();

  const stats = useMemo(() => {
    const day = todayISO();
    // Every rupee here comes from the same periodStats() the Dashboard uses
    // for "today", so the two cards can never disagree: tax-inclusive
    // billed figure (frozen tax on bills, bookings AND snack sales), tax
    // and tab-aware pending, "On tab" sales not counted as cash, and snack
    // sales already folded into a bill counted once (on the bill).
    const s = statsForDay(
      { bills, bookings, sales, expenses: [], tabEntries },
      day,
    );
    const todayBills = bills.filter((b) => dayKey(b.bill_date) === day);
    const todayBookings = bookings.filter(
      (b) => dayKey(b.booking_date) === day && isFinancialBooking(b),
    );
    const todaySales = sales.filter(
      (x) => dayKey(x.sale_date) === day && isFinancialSale(x),
    );

    return {
      count: todayBills.length + todayBookings.length + todaySales.length,
      bookings: todayBookings.length,
      billed: s.revenue,
      collected: s.collected,
      due: s.dues,
    };
  }, [bills, bookings, sales, tabEntries]);

  return (
    <Card className="frost">
      <CardContent className="space-y-4 p-5">
        <SectionHeading
          eyebrow="TODAY"
          title="Today at a glance"
          icon={CalendarDays}
        />
        <LayoutParts
          sectionId="bills.today-summary"
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          <LayoutPart id="bills.today-summary.count">
            <Stat
              icon={<ReceiptText className="size-4 text-primary" />}
              label="Bills today"
              value={String(stats.count)}
              hint={`${stats.bookings} turf booking${stats.bookings === 1 ? "" : "s"}`}
            />
          </LayoutPart>
          <LayoutPart id="bills.today-summary.billed">
            <Stat
              icon={<IndianRupee className="size-4 text-primary" />}
              label="Billed"
              value={money(stats.billed)}
            />
          </LayoutPart>
          <LayoutPart id="bills.today-summary.collected">
            <Stat
              icon={<TrendingUp className="size-4 text-success" />}
              label="Collected"
              value={money(stats.collected)}
              good
            />
          </LayoutPart>
          <LayoutPart id="bills.today-summary.pending">
            <Stat
              icon={<IndianRupee className="size-4 text-destructive" />}
              label="Pending"
              value={money(stats.due)}
              danger
            />
          </LayoutPart>
        </LayoutParts>
      </CardContent>
    </Card>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
  danger,
  good,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  danger?: boolean;
  good?: boolean;
}) {
  return (
    <div className="frost-soft rounded-xl border p-3">
      <p className="micro-label flex items-center gap-1.5">
        {icon}
        {label}
      </p>
      <p
        className={cn(
          "stat-value mt-1 text-lg",
          danger ? "text-destructive" : good ? "text-success" : "text-primary",
        )}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
