import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  FileDown,
  FileText,
  Percent,
  Receipt,
  TicketPercent,
  Wallet,
  Wallet2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion } from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDMY, money, whatsappUrl } from "@/lib/biz";
import { exportToExcel, exportWorkbook } from "@/lib/xlsx";
import { INVOICE_SECTIONS } from "@/lib/desktop";
import { buildDashboardSheet } from "@/lib/dashboard-xlsx";
import {
  downloadReportPdf,
  reportPdfMoney,
  shareReportPdf,
  type ReportPdfDoc,
} from "@/lib/report-pdf";
import { readPrintSettings } from "@/lib/print";
import {
  useExpensesV2,
  useSnackSales,
  useTurfBookings,
  useUpdateTurfBooking,
} from "@/lib/ops";
import { customerLifetimeStats, useBills, useCustomers } from "@/lib/data";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  AGE_BUCKET_META,
  ageBucket,
  customerRanking,
  dataDateRange,
  duesAgeing,
  expenseByCategory,
  isFinancialBooking,
  itemPerformance,
  lastMonthKeys,
  monthKey,
  monthLabel,
  monthsBetween,
  paymentSplit,
  pctChange,
  prevMonthKey,
  profitAndLoss,
  statsForMonth,
  taxReport,
  turfOccupancy,
  type Sources,
} from "@/lib/analytics";
import { activeTaxes, readAppSettings } from "@/lib/settings";
import { bookingCashCollected, bookingDue, isFinancialSale } from "@/lib/dues";
import { useTabEntries } from "@/lib/tabs";
import { bookingGrossTotal, bookingTaxable } from "@/lib/biz";
import { rupees } from "@/lib/money";
import {
  compareBy,
  sortSuffix,
  useSortState,
  type SortOption,
} from "@/lib/sort";
import { DeltaStat } from "./DeltaStat";
import { HeroStat, MiniStat } from "./HeroStat";
import { ProfitMixCard } from "./ProfitMixCard";
import { TopCustomersCard } from "./TopCustomersCard";
import { TurfUsageDetailCard } from "./TurfUsageDetailCard";
import { ItemPerformanceCard } from "./ItemPerformanceCard";
import { SectionHeading } from "./SectionHeading";
import { SettingsSection } from "./SettingsSection";
import { SortMenu } from "./SortMenu";
import {
  LayoutSection,
  LayoutSections,
  LayoutPart,
  LayoutParts,
} from "./LayoutSection";
import { usePersistedState } from "@/lib/ui-prefs";

const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

type ItemSortField = "qty" | "revenue" | "profit" | "name";

const ITEM_SORT_OPTIONS: SortOption<ItemSortField>[] = [
  { value: "revenue", label: "Revenue", defaultDir: "desc" },
  { value: "qty", label: "Qty", defaultDir: "desc" },
  { value: "profit", label: "Profit", defaultDir: "desc" },
  { value: "name", label: "Name", defaultDir: "asc" },
];

type TurfDuesSortField = "due" | "name" | "date";

const TURF_DUES_SORT_OPTIONS: SortOption<TurfDuesSortField>[] = [
  { value: "due", label: "Due amount", defaultDir: "desc" },
  { value: "name", label: "Customer", defaultDir: "asc" },
  { value: "date", label: "Booking date", defaultDir: "desc" },
];

/** Quick-jump targets shown as chips under the month picker. */
function quickMonthTargets() {
  const now = new Date();
  const thisMonth = monthKey(now);
  const lastMonth = prevMonthKey(thisMonth);
  const threeAgo = monthKey(new Date(now.getFullYear(), now.getMonth() - 3, 1));
  const lastYear = monthKey(new Date(now.getFullYear() - 1, now.getMonth(), 1));
  return [
    { label: "This month", key: thisMonth },
    { label: "Last month", key: lastMonth },
    { label: "3 months ago", key: threeAgo },
    { label: "Same month last year", key: lastYear },
  ];
}

export function ReportsTab() {
  const { data: bills = [] } = useBills();
  const { data: bookings = [] } = useTurfBookings();
  const { data: sales = [] } = useSnackSales();
  const { data: expenses = [] } = useExpensesV2();
  const { data: customers = [] } = useCustomers();
  const updateBooking = useUpdateTurfBooking();
  const isMobile = useIsMobile();

  const [month, setMonth] = useState(() => monthKey(new Date()));
  const monthChips = useMemo(quickMonthTargets, []);
  // "Owner summary" shows only the headline figures a shop owner checks day
  // to day (revenue, collected, outstanding, expenses, profit, tax, cash vs
  // UPI); "Detailed" reveals everything below it — the exact same sections
  // and data this tab already rendered before this toggle existed. Nothing
  // is removed in either mode, only shown or hidden.
  const [reportView, setReportView] = usePersistedState<"summary" | "detailed">(
    "reports-view",
    "summary",
  );
  const itemSort = useSortState<ItemSortField>(
    "reports-items",
    ITEM_SORT_OPTIONS,
    {
      field: "revenue",
      dir: "desc",
    },
  );

  const inMonth = useMemo(() => {
    const b = bookings.filter(
      (x) => monthKey(x.booking_date) === month && isFinancialBooking(x),
    );
    const s = sales.filter((x) => monthKey(x.sale_date) === month);
    const e = expenses.filter((x) => monthKey(x.spent_at) === month);
    return { b, s, e };
  }, [bookings, sales, expenses, month]);

  // Single shared source of truth for revenue/profit math (also used by the
  // trend chart and Excel export below), so the KPI cards can't drift out of
  // sync with them. This previously duplicated the calculation by hand from
  // just turf bookings + snack sales, which silently excluded any revenue
  // that had been merged into a Bill (see MergeBillDialog) — so "Net profit"
  // on screen could under-report versus the trend chart/export right below it.
  const { data: tabEntries = [] } = useTabEntries();
  // The tab ledger rides along so a balance moved onto a customer's running
  // tab is taken off its source booking/bill here exactly as the Dues tab
  // does (and tab payments count as collected) — see periodStats().
  const src = useMemo<Sources>(
    () => ({ bills, bookings, sales, expenses, tabEntries }),
    [bills, bookings, sales, expenses, tabEntries],
  );
  const cur = useMemo(() => statsForMonth(src, month), [src, month]);

  const kpis = useMemo(() => {
    // "Outstanding turf dues" is intentionally turf-bookings-only (not bills),
    // so it's kept as its own calculation rather than cur.dues. Routed
    // through bookingDue() (dues.ts) — the same tax-inclusive figure the
    // Turf tab, Dues tab and Dashboard show for the same booking — instead
    // of a hand-rolled total_amount - advance_paid, which used to silently
    // drop the tax on a taxed booking (see docs/calculation-rules.md §2/§8).
    const dues = inMonth.b.reduce((n, x) => n + bookingDue(x, tabEntries), 0);
    return {
      turf: cur.turfRevenue,
      snacks: cur.snacksRevenue,
      spend: cur.expenses,
      profit: cur.profit,
      dues,
      snackProfit: cur.snackProfit,
    };
  }, [inMonth, cur, tabEntries]);

  const itemRows = useMemo(() => {
    const map = new Map<
      string,
      { name: string; qty: number; revenue: number; profit: number }
    >();
    // Sales rolled into a merged bill are no longer their own financial
    // record (see lib/dues.ts isFinancialSale / itemPerformance) — their
    // revenue is on the bill now, so counting their items here too would
    // double-count that item's qty/revenue against the merged bill.
    for (const s of inMonth.s.filter(isFinancialSale))
      for (const it of s.items ?? []) {
        const name = (it.item_name || "Item").trim();
        const prev = map.get(name) ?? { name, qty: 0, revenue: 0, profit: 0 };
        prev.qty += Number(it.qty) || 0;
        prev.revenue += Number(it.amount) || 0;
        prev.profit +=
          (Number(it.amount) || 0) -
          (Number(it.qty) || 0) * (Number(it.cost_price) || 0);
        map.set(name, prev);
      }
    return [...map.values()].sort((a, b) => {
      switch (itemSort.field) {
        case "qty":
          return compareBy(a.qty, b.qty, itemSort.dir);
        case "profit":
          return compareBy(a.profit, b.profit, itemSort.dir);
        case "name":
          return compareBy(
            a.name.toLowerCase(),
            b.name.toLowerCase(),
            itemSort.dir,
          );
        case "revenue":
        default:
          return compareBy(a.revenue, b.revenue, itemSort.dir);
      }
    });
  }, [inMonth, itemSort.field, itemSort.dir]);

  const pieData = useMemo(
    () => itemRows.slice(0, 5).map((r) => ({ name: r.name, value: r.revenue })),
    [itemRows],
  );

  // One canonical "still owed" per booking — bookingDue() (dues.ts):
  // tax-inclusive via the FROZEN tax on the booking and net of anything
  // moved to the customer's running tab. The list, its sort, the Excel
  // "Due" column and the "Mark paid" amount below all read this one number.
  const dues = useMemo(
    () =>
      bookings
        .filter((b) => bookingDue(b, tabEntries) > 0)
        .map((b) => ({
          ...b,
          gross: bookingGrossTotal(b),
          // Stored figure — "Mark paid" writes `paid + due` back to
          // advance_paid, so it must stay the raw stored number.
          paid: rupees(b.advance_paid),
          // What the customer actually handed over: `advance_paid` less
          // anything sitting on their running tab for this booking. Display
          // only (bookingCashCollected, dues.ts).
          cashPaid: bookingCashCollected(b, tabEntries),
          due: bookingDue(b, tabEntries),
        })),
    [bookings, tabEntries],
  );

  const turfDuesSort = useSortState<TurfDuesSortField>(
    "reports-turf-dues",
    TURF_DUES_SORT_OPTIONS,
    { field: "due", dir: "desc" },
  );
  // Long per-booking due list — collapsible like a Settings dropdown instead
  // of always taking up the full page. Open by default so nothing changes
  // for anyone who hasn't touched it yet.
  const [duesSectionOpen, setDuesSectionOpen] = usePersistedState<string[]>(
    "reports-open-sections",
    ["turf-dues"],
  );
  const sortedDues = useMemo(
    () =>
      [...dues].sort((a, b) => {
        switch (turfDuesSort.field) {
          case "name":
            return compareBy(
              a.customer_name.toLowerCase(),
              b.customer_name.toLowerCase(),
              turfDuesSort.dir,
            );
          case "date":
            return compareBy(a.booking_date, b.booking_date, turfDuesSort.dir);
          case "due":
          default:
            return compareBy(a.due, b.due, turfDuesSort.dir);
        }
      }),
    [dues, turfDuesSort.field, turfDuesSort.dir],
  );

  // All outstanding turf dues currently loaded (not just this report month —
  // an unpaid slot from three months ago is still owed today), grouped by
  // how overdue it is. Same helper backs the Excel/PDF exports below.
  const duesByAge = useMemo(
    () => duesAgeing(bookings, Date.now(), tabEntries),
    [bookings, tabEntries],
  );

  const supporting = [
    { label: "Turf revenue", value: kpis.turf },
    { label: "Snacks revenue", value: kpis.snacks },
    { label: "Total expenses", value: kpis.spend },
    { label: "Outstanding turf dues", value: kpis.dues },
    { label: "Snacks gross profit", value: kpis.snackProfit },
  ];

  const prev = useMemo(
    () => statsForMonth(src, prevMonthKey(month)),
    [src, month],
  );
  const pnl = useMemo(
    () => profitAndLoss(src, lastMonthKeys(month, 6)),
    [src, month],
  );

  const appSettings = useMemo(() => readAppSettings(), []);
  const taxesActive = useMemo(() => activeTaxes(appSettings), [appSettings]);
  const taxRows = useMemo(
    () =>
      taxesActive.length > 0
        ? taxReport(src, lastMonthKeys(month, 6), appSettings)
        : [],
    [src, month, taxesActive.length, appSettings],
  );
  const curTaxRow = taxRows[taxRows.length - 1] ?? null;

  const split = useMemo(
    () => paymentSplit(src, (iso) => monthKey(iso) === month),
    [src, month],
  );
  const categories = useMemo(
    () => expenseByCategory(src, (iso) => monthKey(iso) === month),
    [src, month],
  );

  const lifetimeStats = useMemo(
    () =>
      customerLifetimeStats(customers, { bills, bookings, sales, tabEntries }),
    [customers, bills, bookings, sales, tabEntries],
  );
  const ranking = useMemo(
    () => customerRanking(lifetimeStats),
    [lifetimeStats],
  );

  // Turf usage + item performance both come from lib/analytics so the cards,
  // the Excel sheets and the PDF statement below can never disagree.
  const occupancy = useMemo(
    () => turfOccupancy(bookings, (iso) => monthKey(iso) === month, tabEntries),
    [bookings, month, tabEntries],
  );
  const itemPerf = useMemo(
    () => itemPerformance(sales, (iso) => monthKey(iso) === month),
    [sales, month],
  );

  // Chart data for "Last 6 months": derived from the same `pnl` rows used by
  // the table above (single source of truth), with a profit-margin %
  // computed alongside so it can ride a secondary axis over the revenue bars.
  // Margin is Profit ÷ NetRevenue (pre-tax), matching how Profit itself is
  // computed (netRevenue − expenses) — dividing by gross Revenue instead
  // would understate margin by diluting it with pass-through tax money.
  const revenueTrend = useMemo(
    () =>
      pnl.map((r) => ({
        month: r.month,
        Turf: r.Turf,
        Snacks: r.Snacks,
        Bills: r.Bills,
        Margin: r.NetRevenue > 0 ? (r.Profit / r.NetRevenue) * 100 : 0,
      })),
    [pnl],
  );
  const expenseTrend = useMemo(
    () => pnl.map((r) => ({ month: r.month, Expenses: r.Expenses })),
    [pnl],
  );

  const insights = useMemo(() => {
    const collectionRate =
      cur.revenue > 0 ? (cur.collected / cur.revenue) * 100 : 0;
    const topExpense = categories[0] ?? null;
    const avgBookingValue =
      inMonth.b.length > 0 ? kpis.turf / inMonth.b.length : 0;
    return { collectionRate, topExpense, avgBookingValue };
  }, [cur, categories, inMonth.b.length, kpis.turf]);

  const compareCards = [
    {
      label: "Net revenue",
      value: cur.netRevenue,
      previous: prev.netRevenue,
      change: pctChange(cur.netRevenue, prev.netRevenue),
      invert: false,
    },
    {
      label: "Tax",
      value: cur.tax,
      previous: prev.tax,
      change: pctChange(cur.tax, prev.tax),
      invert: false,
    },
    {
      label: "Revenue (incl. tax)",
      value: cur.revenue,
      previous: prev.revenue,
      change: pctChange(cur.revenue, prev.revenue),
      invert: false,
    },
    {
      label: "Collected",
      value: cur.collected,
      previous: prev.collected,
      change: pctChange(cur.collected, prev.collected),
      invert: false,
    },
    {
      label: "Expenses",
      value: cur.expenses,
      previous: prev.expenses,
      change: pctChange(cur.expenses, prev.expenses),
      invert: true,
    },
    {
      label: "Profit",
      value: cur.profit,
      previous: prev.profit,
      change: pctChange(cur.profit, prev.profit),
      invert: false,
    },
  ];

  const exportReport = () => {
    const printSettings = readPrintSettings();
    const prevCollectionRate =
      prev.revenue > 0 ? (prev.collected / prev.revenue) * 100 : 0;
    const dashboardKpis = [
      {
        label: "Net revenue",
        value: cur.netRevenue,
        previous: prev.netRevenue,
        change: pctChange(cur.netRevenue, prev.netRevenue),
        invert: false,
      },
      {
        label: "Tax",
        value: cur.tax,
        previous: prev.tax,
        change: pctChange(cur.tax, prev.tax),
        invert: false,
      },
      {
        label: "Revenue (incl. tax)",
        value: cur.revenue,
        previous: prev.revenue,
        change: pctChange(cur.revenue, prev.revenue),
        invert: false,
      },
      {
        label: "Profit",
        value: cur.profit,
        previous: prev.profit,
        change: pctChange(cur.profit, prev.profit),
        invert: false,
      },
      {
        label: "Collected",
        value: cur.collected,
        previous: prev.collected,
        change: pctChange(cur.collected, prev.collected),
        invert: false,
      },
      {
        label: "Expenses",
        value: cur.expenses,
        previous: prev.expenses,
        change: pctChange(cur.expenses, prev.expenses),
        invert: true,
      },
      {
        label: "Dues",
        value: cur.dues,
        previous: prev.dues,
        change: pctChange(cur.dues, prev.dues),
        invert: true,
      },
      {
        label: "Collection rate",
        value: insights.collectionRate,
        previous: prevCollectionRate,
        change: pctChange(insights.collectionRate, prevCollectionRate),
        invert: false,
        isCurrency: false,
      },
    ];
    exportWorkbook(
      [
        {
          name: "Dashboard",
          build: (ws) =>
            buildDashboardSheet(ws, {
              shopName: printSettings.shopName || "Business",
              periodLabel: monthLabel(month),
              currencySymbol: printSettings.currencySymbol,
              kpis: dashboardKpis,
              collectionRatePct: insights.collectionRate,
              topExpense: insights.topExpense,
              avgBookingValue: insights.avgBookingValue,
              pnl: pnl.map((r) => ({
                month: r.month,
                Revenue: r.Revenue,
                Expenses: r.Expenses,
                Profit: r.Profit,
              })),
            }),
        },
        {
          name: "Summary",
          rows: compareCards.map((c) => ({
            Metric: c.label,
            [monthLabel(month)]: c.value,
            [monthLabel(prevMonthKey(month))]: c.previous,
            "Change %": c.change === null ? "n/a" : Number(c.change.toFixed(1)),
          })),
        },
        {
          name: "Profit and loss",
          rows: pnl.map((r) => ({
            Month: r.month,
            Turf: r.Turf,
            Snacks: r.Snacks,
            Bills: r.Bills,
            "Revenue (incl. tax)": r.Revenue,
            Expenses: r.Expenses,
            Profit: r.Profit,
            Collected: r.Collected,
            Dues: r.Dues,
          })),
        },
        {
          name: "Payment modes",
          rows: split.map((s) => ({ Mode: s.name, Amount: s.value })),
        },
        {
          name: "Expenses",
          rows: categories.map((c) => ({ Category: c.name, Amount: c.value })),
        },
        ...(taxRows.length > 0
          ? [
              {
                name: "Tax",
                rows: taxRows.map((r) => ({
                  Month: r.month,
                  "Taxable value": r.taxableValue,
                  ...Object.fromEntries(r.lines.map((l) => [l.label, l.value])),
                  "Total tax": r.totalTax,
                  "Gross value": r.grossValue,
                })),
              },
            ]
          : []),
        {
          name: "Items",
          rows: itemRows.map((r) => ({
            Item: r.name,
            Qty: r.qty,
            Revenue: r.revenue,
            Profit: r.profit,
          })),
        },
        {
          name: "Turf usage",
          rows: [
            {
              Bookings: occupancy.bookingCount,
              "Booked hours": occupancy.bookedHours,
              Revenue: occupancy.revenue,
              "Avg. slot value": occupancy.avgSlotValue,
              "Avg. slot hours": occupancy.avgSlotHours,
              "Cancelled slots": occupancy.cancelled.count,
              "Cancelled amount": occupancy.cancelled.amount,
              "Unpaid slots": occupancy.unpaid.count,
              "Unpaid amount": occupancy.unpaid.amount,
              "Busiest weekday": occupancy.busiestWeekday?.label ?? "",
              "Busiest hour": occupancy.busiestHour?.label ?? "",
            },
          ],
        },
        {
          name: "Turf usage by weekday",
          rows: occupancy.byWeekday.map((r) => ({
            Weekday: r.label,
            Bookings: r.bookings,
            Hours: r.hours,
            Revenue: r.revenue,
            "Share %": Number(r.sharePct.toFixed(1)),
          })),
        },
        {
          name: "Turf usage by hour",
          rows: occupancy.byHour.map((r) => ({
            Hour: r.label,
            Bookings: r.bookings,
            Hours: r.hours,
            Revenue: r.revenue,
            "Share %": Number(r.sharePct.toFixed(1)),
          })),
        },
        {
          name: "Best & slow items",
          rows: [
            ...itemPerf.topByRevenue.map((r) => ({
              List: "Top by revenue",
              Item: r.name,
              Qty: r.qty,
              Revenue: r.revenue,
              Profit: r.profit,
              "Margin %": Number(r.marginPct.toFixed(1)),
            })),
            ...itemPerf.topByProfit.map((r) => ({
              List: "Top by profit",
              Item: r.name,
              Qty: r.qty,
              Revenue: r.revenue,
              Profit: r.profit,
              "Margin %": Number(r.marginPct.toFixed(1)),
            })),
            ...itemPerf.slowMovers.map((r) => ({
              List: "Slow movers",
              Item: r.name,
              Qty: r.qty,
              Revenue: r.revenue,
              Profit: r.profit,
              "Margin %": Number(r.marginPct.toFixed(1)),
            })),
          ],
        },
        {
          name: "Outstanding dues by age",
          rows: duesByAge.map((r) => ({
            "Age bucket": r.label,
            Count: r.count,
            Amount: r.amount,
          })),
        },
        {
          name: "Outstanding dues",
          autofilter: true,
          moneyColumns: ["Total", "Paid", "Due"],
          rows: dues.map((b) => ({
            "Booking ID": b.booking_no,
            Date: formatDMY(b.booking_date),
            Customer: b.customer_name,
            Phone: b.phone ?? "",
            Total: b.gross,
            Paid: b.paid,
            Due: b.due,
            "Age bucket": AGE_BUCKET_META[ageBucket(b.booking_date)],
          })),
        },
        // Raw record-level sheets — every row currently loaded (the app's
        // active year window, not just the selected report month), so an
        // owner or accountant can filter/pivot on real transactions instead
        // of only the aggregated tables above.
        {
          name: "Turf bookings",
          autofilter: true,
          moneyColumns: [
            "Rate/hr",
            "Amount",
            "Tax",
            "Total",
            "Advance paid",
            "Balance due",
          ],
          rows: bookings.map((b) => ({
            "Booking ID": b.booking_no,
            Date: formatDMY(b.booking_date),
            Customer: b.customer_name,
            Phone: b.phone ?? "",
            Slot: b.slot_name,
            Hours: b.hours,
            "Rate/hr": b.rate_per_hour,
            // A merged booking's revenue is already counted on its Bill, so
            // the amount here is zeroed (matching the same convention the
            // Turf tab's own export uses) — otherwise a plain SUM() over
            // this column would double-count that money.
            Amount: isFinancialBooking(b) ? rupees(b.total_amount) : 0,
            // Frozen tax + tax-inclusive total/due — the same figures the
            // Turf tab, the receipt and the Dashboard show for this booking.
            Tax: isFinancialBooking(b)
              ? bookingGrossTotal(b) - bookingTaxable(b)
              : 0,
            Total: isFinancialBooking(b) ? bookingGrossTotal(b) : 0,
            // Real cash taken (bookingCashCollected), not the stored
            // advance_paid — a balance moved to the customer's tab would
            // otherwise show here AND again as a dues collection.
            "Advance paid": isFinancialBooking(b)
              ? bookingCashCollected(b, tabEntries)
              : 0,
            "Balance due": bookingDue(b, tabEntries),
            "Payment mode": b.payment_mode,
            Status: b.status,
            "Merged into bill": b.merged_into_bill_id
              ? "Yes — see Bills"
              : "No",
          })),
        },
        {
          name: "Snack sales",
          autofilter: true,
          moneyColumns: ["Unit price", "Amount", "Profit"],
          rows: sales.flatMap((s) =>
            (s.items ?? []).map((it) => ({
              "Bill No": s.bill_no,
              Date: formatDMY(s.sale_date),
              Customer: s.customer_name ?? "",
              Item: it.item_name,
              Qty: it.qty,
              "Unit price": it.unit_price,
              // A sale rolled into a merged bill is no longer its own
              // financial record (isFinancialSale) — its revenue is on the
              // bill now, so a plain SUM() over this column would
              // double-count it, same reason "Turf bookings" above zeroes
              // Amount for a merged booking.
              Amount: isFinancialSale(s) ? it.amount : 0,
              Profit: isFinancialSale(s)
                ? it.amount - it.qty * it.cost_price
                : 0,
              "Payment mode": s.payment_mode,
              // Mirrors the Turf bookings sheet's "Status" column above —
              // a snack sale has no multi-value status of its own, just
              // sold vs. voided (see SnackSale.cancelled in ops.ts).
              Status: s.cancelled ? "Cancelled" : "",
              "Merged into bill": s.merged_into_bill_id
                ? "Yes — see Bills"
                : "No",
            })),
          ),
        },
        {
          name: "Expenses (raw)",
          autofilter: true,
          moneyColumns: ["Amount"],
          rows: expenses.map((e) => ({
            "Expense ID": e.expense_no ?? "",
            Date: formatDMY(e.spent_at),
            Business: e.business,
            Category: e.category,
            Description: e.description ?? "",
            Amount: e.amount,
            Notes: e.note ?? "",
          })),
        },
        {
          name: "Customers",
          autofilter: true,
          moneyColumns: [
            "Lifetime spend",
            "Bills spend",
            "Turf spend",
            "Snacks spend",
            "Avg. booking value",
            "Outstanding turf dues",
            "Outstanding bill dues",
            "Running tab",
            "Total owed",
          ],
          rows: lifetimeStats
            .slice()
            .sort((a, b) => b.totalSpend - a.totalSpend)
            .map((c) => ({
              Name: c.name,
              Phone: c.phone ?? "",
              "Turf bookings": c.bookingsCount,
              "Lifetime spend": c.totalSpend,
              "Bills spend": c.billsSpend,
              "Turf spend": c.turfSpend,
              "Snacks spend": c.snacksSpend,
              "Avg. booking value": c.avgBookingValue,
              "Outstanding turf dues": c.outstandingTurfDues,
              "Outstanding bill dues": c.outstandingBillDues,
              "Running tab": c.outstandingTab,
              "Total owed": c.outstandingTotal,
              "First visit": c.firstActivity ? formatDMY(c.firstActivity) : "",
              "Last activity": c.lastActivity ? formatDMY(c.lastActivity) : "",
            })),
        },
      ],
      `report-${month}`,
      INVOICE_SECTIONS.reports,
    );
    toast.success("Report exported");
  };

  /**
   * "All time" export — #7's actual fix. The button above is scoped to
   * `month` (plus a trailing 6-month P&L/tax trend baked in via
   * `lastMonthKeys`), so there was previously no way to export the
   * business's complete history regardless of how many years of data
   * exist. This determines the true range from the data itself
   * (`dataDateRange`) rather than assuming any fixed window, spans it with
   * `monthsBetween` (extends `profitAndLoss`/`taxReport` cleanly — they
   * already aggregate per month), and drops the `monthKey(iso) === month`
   * filter for the other sheets (`() => true` matches every record) so
   * they aggregate across the whole range instead of collapsing to one
   * month.
   *
   * Deliberately built from scratch here rather than as a `useMemo` at
   * component level — this tab stays mounted, and re-scanning years of
   * bookings/sales/expenses on every render for an export that might
   * never be clicked would be wasted work. Everything below only runs
   * when the person actually picks "All time".
   *
   * The Dashboard/Summary sheets (month-vs-previous-month KPI cards) don't
   * have a sensible "all time" equivalent — there's no "previous" period
   * to compare all of history against — so this workbook omits them and
   * leads with the Profit & loss trend instead.
   */
  const exportFullReport = async () => {
    const range = dataDateRange(src);
    if (!range) {
      toast.error("Nothing to export yet", {
        description: "No records are loaded on this device.",
      });
      return;
    }
    const keys = monthsBetween(range.earliest, range.latest);
    const pnlFull = profitAndLoss(src, keys);
    const taxRowsFull =
      taxesActive.length > 0 ? taxReport(src, keys, appSettings) : [];
    const splitFull = paymentSplit(src, () => true);
    const categoriesFull = expenseByCategory(src, () => true);
    const occupancyFull = turfOccupancy(bookings, () => true, tabEntries);
    const itemPerfFull = itemPerformance(sales, () => true);

    await exportWorkbook(
      [
        {
          name: "Profit and loss",
          rows: pnlFull.map((r) => ({
            Month: r.month,
            Turf: r.Turf,
            Snacks: r.Snacks,
            Bills: r.Bills,
            "Revenue (incl. tax)": r.Revenue,
            Expenses: r.Expenses,
            Profit: r.Profit,
            Collected: r.Collected,
            Dues: r.Dues,
          })),
        },
        {
          name: "Payment modes",
          rows: splitFull.map((s) => ({ Mode: s.name, Amount: s.value })),
        },
        {
          name: "Expenses",
          rows: categoriesFull.map((c) => ({
            Category: c.name,
            Amount: c.value,
          })),
        },
        ...(taxRowsFull.length > 0
          ? [
              {
                name: "Tax",
                rows: taxRowsFull.map((r) => ({
                  Month: r.month,
                  "Taxable value": r.taxableValue,
                  ...Object.fromEntries(r.lines.map((l) => [l.label, l.value])),
                  "Total tax": r.totalTax,
                  "Gross value": r.grossValue,
                })),
              },
            ]
          : []),
        {
          name: "Items",
          rows: itemPerfFull.rows.map((r) => ({
            Item: r.name,
            Qty: r.qty,
            Revenue: r.revenue,
            Profit: r.profit,
          })),
        },
        {
          name: "Turf usage",
          rows: [
            {
              Bookings: occupancyFull.bookingCount,
              "Booked hours": occupancyFull.bookedHours,
              Revenue: occupancyFull.revenue,
              "Avg. slot value": occupancyFull.avgSlotValue,
              "Avg. slot hours": occupancyFull.avgSlotHours,
              "Cancelled slots": occupancyFull.cancelled.count,
              "Cancelled amount": occupancyFull.cancelled.amount,
              "Unpaid slots": occupancyFull.unpaid.count,
              "Unpaid amount": occupancyFull.unpaid.amount,
              "Busiest weekday": occupancyFull.busiestWeekday?.label ?? "",
              "Busiest hour": occupancyFull.busiestHour?.label ?? "",
            },
          ],
        },
        {
          name: "Turf usage by weekday",
          rows: occupancyFull.byWeekday.map((r) => ({
            Weekday: r.label,
            Bookings: r.bookings,
            Hours: r.hours,
            Revenue: r.revenue,
            "Share %": Number(r.sharePct.toFixed(1)),
          })),
        },
        {
          name: "Turf usage by hour",
          rows: occupancyFull.byHour.map((r) => ({
            Hour: r.label,
            Bookings: r.bookings,
            Hours: r.hours,
            Revenue: r.revenue,
            "Share %": Number(r.sharePct.toFixed(1)),
          })),
        },
        {
          name: "Best & slow items",
          rows: [
            ...itemPerfFull.topByRevenue.map((r) => ({
              List: "Top by revenue",
              Item: r.name,
              Qty: r.qty,
              Revenue: r.revenue,
              Profit: r.profit,
              "Margin %": Number(r.marginPct.toFixed(1)),
            })),
            ...itemPerfFull.topByProfit.map((r) => ({
              List: "Top by profit",
              Item: r.name,
              Qty: r.qty,
              Revenue: r.revenue,
              Profit: r.profit,
              "Margin %": Number(r.marginPct.toFixed(1)),
            })),
            ...itemPerfFull.slowMovers.map((r) => ({
              List: "Slow movers",
              Item: r.name,
              Qty: r.qty,
              Revenue: r.revenue,
              Profit: r.profit,
              "Margin %": Number(r.marginPct.toFixed(1)),
            })),
          ],
        },
        {
          name: "Outstanding dues by age",
          rows: duesByAge.map((r) => ({
            "Age bucket": r.label,
            Count: r.count,
            Amount: r.amount,
          })),
        },
        {
          name: "Outstanding dues",
          autofilter: true,
          moneyColumns: ["Total", "Paid", "Due"],
          rows: dues.map((b) => ({
            "Booking ID": b.booking_no,
            Date: formatDMY(b.booking_date),
            Customer: b.customer_name,
            Phone: b.phone ?? "",
            Total: b.gross,
            Paid: b.paid,
            Due: b.due,
            "Age bucket": AGE_BUCKET_META[ageBucket(b.booking_date)],
          })),
        },
        // Raw record-level sheets — these are already every row currently
        // loaded (not month-filtered) in the month-scoped export above too,
        // so they carry over unchanged.
        {
          name: "Turf bookings",
          autofilter: true,
          moneyColumns: [
            "Rate/hr",
            "Amount",
            "Tax",
            "Total",
            "Advance paid",
            "Balance due",
          ],
          rows: bookings.map((b) => ({
            "Booking ID": b.booking_no,
            Date: formatDMY(b.booking_date),
            Customer: b.customer_name,
            Phone: b.phone ?? "",
            Slot: b.slot_name,
            Hours: b.hours,
            "Rate/hr": b.rate_per_hour,
            Amount: isFinancialBooking(b) ? rupees(b.total_amount) : 0,
            Tax: isFinancialBooking(b)
              ? bookingGrossTotal(b) - bookingTaxable(b)
              : 0,
            Total: isFinancialBooking(b) ? bookingGrossTotal(b) : 0,
            "Advance paid": isFinancialBooking(b)
              ? bookingCashCollected(b, tabEntries)
              : 0,
            "Balance due": bookingDue(b, tabEntries),
            "Payment mode": b.payment_mode,
            Status: b.status,
            "Merged into bill": b.merged_into_bill_id
              ? "Yes — see Bills"
              : "No",
          })),
        },
        {
          name: "Snack sales",
          autofilter: true,
          moneyColumns: ["Unit price", "Amount", "Profit"],
          rows: sales.flatMap((s) =>
            (s.items ?? []).map((it) => ({
              "Bill No": s.bill_no,
              Date: formatDMY(s.sale_date),
              Customer: s.customer_name ?? "",
              Item: it.item_name,
              Qty: it.qty,
              "Unit price": it.unit_price,
              // A sale rolled into a merged bill is no longer its own
              // financial record (isFinancialSale) — its revenue is on the
              // bill now, so a plain SUM() over this column would
              // double-count it, same reason "Turf bookings" above zeroes
              // Amount for a merged booking.
              Amount: isFinancialSale(s) ? it.amount : 0,
              Profit: isFinancialSale(s)
                ? it.amount - it.qty * it.cost_price
                : 0,
              "Payment mode": s.payment_mode,
              // Mirrors the Turf bookings sheet's "Status" column above —
              // a snack sale has no multi-value status of its own, just
              // sold vs. voided (see SnackSale.cancelled in ops.ts).
              Status: s.cancelled ? "Cancelled" : "",
              "Merged into bill": s.merged_into_bill_id
                ? "Yes — see Bills"
                : "No",
            })),
          ),
        },
        {
          name: "Expenses (raw)",
          autofilter: true,
          moneyColumns: ["Amount"],
          rows: expenses.map((e) => ({
            "Expense ID": e.expense_no ?? "",
            Date: formatDMY(e.spent_at),
            Business: e.business,
            Category: e.category,
            Description: e.description ?? "",
            Amount: e.amount,
            Notes: e.note ?? "",
          })),
        },
        {
          name: "Customers",
          autofilter: true,
          moneyColumns: [
            "Lifetime spend",
            "Bills spend",
            "Turf spend",
            "Snacks spend",
            "Avg. booking value",
            "Outstanding turf dues",
            "Outstanding bill dues",
            "Running tab",
            "Total owed",
          ],
          rows: lifetimeStats
            .slice()
            .sort((a, b) => b.totalSpend - a.totalSpend)
            .map((c) => ({
              Name: c.name,
              Phone: c.phone ?? "",
              "Turf bookings": c.bookingsCount,
              "Lifetime spend": c.totalSpend,
              "Bills spend": c.billsSpend,
              "Turf spend": c.turfSpend,
              "Snacks spend": c.snacksSpend,
              "Avg. booking value": c.avgBookingValue,
              "Outstanding turf dues": c.outstandingTurfDues,
              "Outstanding bill dues": c.outstandingBillDues,
              "Running tab": c.outstandingTab,
              "Total owed": c.outstandingTotal,
              "First visit": c.firstActivity ? formatDMY(c.firstActivity) : "",
              "Last activity": c.lastActivity ? formatDMY(c.lastActivity) : "",
            })),
        },
      ],
      // Distinct from `report-<month>` so a person can tell a full export
      // apart from a monthly one at a glance — exportWorkbook still appends
      // "-<exportdate>.xlsx" on top of this.
      `reports-full-${range.earliest}_${range.latest}`,
      INVOICE_SECTIONS.reports,
    );
    toast.success("Full history exported", {
      description: `${keys.length} months · ${formatDMY(range.earliest)} to ${formatDMY(range.latest)}`,
    });
  };

  const buildStatementDoc = (): ReportPdfDoc => {
    const s = readPrintSettings();
    return {
      title: `Monthly statement — ${monthLabel(month)}`,
      subtitle: `${s.shopName || "Business"} · generated for ${monthLabel(month)}`,
      fileName: `statement-${month}`,
      tables: [
        {
          title: `${monthLabel(month)} vs ${monthLabel(prevMonthKey(month))}`,
          columns: [
            "Metric",
            monthLabel(month),
            monthLabel(prevMonthKey(month)),
            "Change",
          ],
          rows: compareCards.map((c) => ({
            cells: [
              c.label,
              reportPdfMoney(c.value, s.currencySymbol),
              reportPdfMoney(c.previous, s.currencySymbol),
              c.change === null
                ? "n/a"
                : `${c.change > 0 ? "+" : ""}${c.change.toFixed(1)}%`,
            ],
            strong: c.label === "Profit",
            negative: c.label === "Profit" && c.value < 0,
          })),
        },
        {
          title: "Profit & loss — last 6 months",
          columns: [
            "Month",
            "Revenue (incl. tax)",
            "Expenses",
            "Profit",
            "Collected",
          ],
          rows: pnl.map((r) => ({
            cells: [
              r.month,
              reportPdfMoney(r.Revenue, s.currencySymbol),
              reportPdfMoney(r.Expenses, s.currencySymbol),
              reportPdfMoney(r.Profit, s.currencySymbol),
              reportPdfMoney(r.Collected, s.currencySymbol),
            ],
            negative: r.Profit < 0,
          })),
        },
        {
          title: "Payment modes",
          columns: ["Mode", "Amount"],
          rows: split.map((p) => ({
            cells: [p.name, reportPdfMoney(p.value, s.currencySymbol)],
          })),
        },
        {
          title: "Expenses by category",
          columns: ["Category", "Amount"],
          rows: categories.map((c) => ({
            cells: [c.name, reportPdfMoney(c.value, s.currencySymbol)],
          })),
        },
        {
          title: `Turf usage — ${monthLabel(month)}`,
          columns: ["Metric", "Value"],
          rows: [
            { cells: ["Bookings", String(occupancy.bookingCount)] },
            { cells: ["Booked hours", occupancy.bookedHours.toFixed(1)] },
            {
              cells: [
                "Avg. slot value",
                reportPdfMoney(occupancy.avgSlotValue, s.currencySymbol),
              ],
            },
            {
              cells: [
                "Avg. slot length",
                `${occupancy.avgSlotHours.toFixed(1)} hrs`,
              ],
            },
            {
              cells: [
                "Cancelled slots",
                `${occupancy.cancelled.count} · ${reportPdfMoney(occupancy.cancelled.amount, s.currencySymbol)}`,
              ],
            },
            {
              cells: [
                "Unpaid slots",
                `${occupancy.unpaid.count} · ${reportPdfMoney(occupancy.unpaid.amount, s.currencySymbol)}`,
              ],
              negative: occupancy.unpaid.count > 0,
            },
            {
              cells: [
                "Busiest weekday",
                occupancy.busiestWeekday?.label ?? "—",
              ],
            },
            { cells: ["Busiest hour", occupancy.busiestHour?.label ?? "—"] },
          ],
        },
        {
          title: "Turf usage by weekday",
          columns: ["Weekday", "Bookings", "Hours", "Revenue"],
          rows: occupancy.byWeekday
            .filter((r) => r.hours > 0)
            .map((r) => ({
              cells: [
                r.label,
                String(r.bookings),
                r.hours.toFixed(1),
                reportPdfMoney(r.revenue, s.currencySymbol),
              ],
            })),
        },
        {
          title: "Best snacks by revenue",
          columns: ["Item", "Qty", "Revenue"],
          rows: itemPerf.topByRevenue.map((r) => ({
            cells: [
              r.name,
              String(r.qty),
              reportPdfMoney(r.revenue, s.currencySymbol),
            ],
          })),
        },
        {
          title: "Best snacks by profit",
          columns: ["Item", "Margin", "Profit"],
          rows: itemPerf.topByProfit.map((r) => ({
            cells: [
              r.name,
              `${r.marginPct.toFixed(0)}%`,
              reportPdfMoney(r.profit, s.currencySymbol),
            ],
          })),
        },
        {
          title: "Slow-moving snacks",
          columns: ["Item", "Qty", "Revenue"],
          rows: itemPerf.slowMovers.map((r) => ({
            cells: [
              r.name,
              String(r.qty),
              reportPdfMoney(r.revenue, s.currencySymbol),
            ],
          })),
        },
        {
          title: "Outstanding dues by age",
          columns: ["Age", "Count", "Amount"],
          rows: duesByAge.map((r) => ({
            cells: [
              r.label,
              String(r.count),
              reportPdfMoney(r.amount, s.currencySymbol),
            ],
            negative: r.bucket === "overdue" && r.amount > 0,
          })),
        },
        ...(taxRows.length > 0
          ? [
              {
                title: "GST / tax — last 6 months",
                columns: [
                  "Month",
                  "Taxable value",
                  ...(taxRows[0]?.lines.map((l) => l.label) ?? []),
                  "Total tax",
                ],
                rows: taxRows.map((r) => ({
                  cells: [
                    r.month,
                    reportPdfMoney(r.taxableValue, s.currencySymbol),
                    ...r.lines.map((l) =>
                      reportPdfMoney(l.value, s.currencySymbol),
                    ),
                    reportPdfMoney(r.totalTax, s.currencySymbol),
                  ],
                })),
              },
            ]
          : []),
      ],
    };
  };

  const exportPdf = () => {
    downloadReportPdf(buildStatementDoc()).then(
      (saved) => {
        if (saved) toast.success("Statement saved");
        else toast.error("Could not save PDF");
      },
      (e) => toast.error(e instanceof Error ? e.message : "Could not save PDF"),
    );
  };

  const sharePdf = () => {
    const text = `${monthLabel(month)} statement: revenue ${money(cur.revenue)} (incl. tax), profit ${money(cur.profit)}.`;
    shareReportPdf(buildStatementDoc(), whatsappUrl(text)).then(
      (result) => {
        if (result !== "cancelled") toast.success("Statement ready to share");
      },
      (e) =>
        toast.error(e instanceof Error ? e.message : "Could not share PDF"),
    );
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="REPORTS"
        title="Reports"
        hint={monthLabel(month)}
        icon={FileText}
        action={
          <ToggleGroup
            type="single"
            variant="outline"
            value={reportView}
            onValueChange={(v) =>
              v && setReportView(v as "summary" | "detailed")
            }
          >
            <ToggleGroupItem value="summary" className="text-xs">
              Owner summary
            </ToggleGroupItem>
            <ToggleGroupItem value="detailed" className="text-xs">
              Detailed
            </ToggleGroupItem>
          </ToggleGroup>
        }
      />

      <LayoutSections tabId="reports" className="space-y-6">
        <LayoutSection id="reports.month-picker">
          <Card className="frost">
            <CardContent className="pt-5">
              <LayoutParts
                sectionId="reports.month-picker"
                className="flex flex-wrap items-end gap-3"
              >
                <LayoutPart id="reports.month-picker.month">
                  <Label className="stat-label text-muted-foreground">
                    Month
                  </Label>
                  <Input
                    className="h-12"
                    type="month"
                    value={month}
                    onChange={(e) =>
                      setMonth(e.target.value || monthKey(new Date()))
                    }
                  />
                </LayoutPart>
                <LayoutPart
                  id="reports.month-picker.quick-months"
                  className="flex flex-wrap gap-1.5 pb-0.5"
                >
                  {monthChips.map((c) => (
                    <Button
                      key={c.label}
                      type="button"
                      size="sm"
                      variant={month === c.key ? "default" : "outline"}
                      className="frost-soft lift h-8 rounded-full px-3 text-xs"
                      onClick={() => setMonth(c.key)}
                    >
                      {c.label}
                    </Button>
                  ))}
                </LayoutPart>
              </LayoutParts>
            </CardContent>
          </Card>
        </LayoutSection>

        <LayoutSection id="reports.hero-kpis">
          <div className="grid gap-3 sm:grid-cols-2">
            <HeroStat
              label="Net profit"
              value={money(kpis.profit)}
              hint={`${monthLabel(month)} · after all expenses`}
              tone={kpis.profit < 0 ? "bad" : "good"}
              footer={<DeltaStat change={pctChange(cur.profit, prev.profit)} />}
            />
            <HeroStat
              label="Total revenue"
              value={money(cur.revenue)}
              hint={`Collected ${money(cur.collected)}`}
              tone="primary"
              footer={
                <DeltaStat change={pctChange(cur.revenue, prev.revenue)} />
              }
            />
          </div>
        </LayoutSection>

        <LayoutSection id="reports.supporting-kpis">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {supporting.map((c) => (
              <MiniStat key={c.label} label={c.label} value={money(c.value)} />
            ))}
          </div>
        </LayoutSection>

        <LayoutSection id="reports.payment-split">
          {split.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No payments recorded this month.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {split.map((s) => (
                <MiniStat key={s.name} label={s.name} value={money(s.value)} />
              ))}
            </div>
          )}
        </LayoutSection>

        <LayoutSection id="reports.tax">
          {curTaxRow && (
            <Card className="frost">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base page-title">
                  <Receipt className="h-4 w-4" />
                  GST / tax — {monthLabel(month)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="frost-well rounded-lg border p-3">
                    <p className="micro-label text-muted-foreground">
                      Taxable value
                    </p>
                    <p className="stat-value text-lg">
                      {money(curTaxRow.taxableValue)}
                    </p>
                  </div>
                  {curTaxRow.lines.map((l) => (
                    <div
                      key={l.label}
                      className="frost-well rounded-lg border p-3"
                    >
                      <p className="micro-label text-muted-foreground">
                        {l.label}
                      </p>
                      <p className="stat-value text-lg">{money(l.value)}</p>
                    </div>
                  ))}
                  <div className="frost-well rounded-lg border p-3">
                    <p className="micro-label text-muted-foreground">
                      Total tax
                    </p>
                    <p className="stat-value text-lg">
                      {money(curTaxRow.totalTax)}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Applies today's tax settings across every month shown — it
                  isn't a record of what each bill charged at the time. Full
                  6-month breakdown is in the Excel export and PDF statement.
                </p>
              </CardContent>
            </Card>
          )}
        </LayoutSection>

        {reportView === "detailed" && (
          <>
            <LayoutSection id="reports.insight-kpis">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <MiniStat
                  label="Collection rate"
                  value={`${insights.collectionRate.toFixed(0)}%`}
                  hint="Collected vs revenue billed"
                  icon={Percent}
                />
                <MiniStat
                  label="Avg. booking value"
                  value={money(insights.avgBookingValue)}
                  hint={`${inMonth.b.length} turf booking${inMonth.b.length === 1 ? "" : "s"} this month`}
                  icon={TicketPercent}
                />
                <Card className="frost">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-1">
                      <p className="stat-label truncate text-muted-foreground">
                        Top expense category
                      </p>
                      <Wallet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </div>
                    {insights.topExpense ? (
                      <>
                        <p className="stat-value mt-1 text-base leading-tight">
                          {insights.topExpense.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {money(insights.topExpense.value)} of{" "}
                          {money(kpis.spend)}
                        </p>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{
                              width: `${kpis.spend > 0 ? Math.min(100, (insights.topExpense.value / kpis.spend) * 100) : 0}%`,
                            }}
                          />
                        </div>
                      </>
                    ) : (
                      <p className="stat-value mt-1 text-base leading-tight text-muted-foreground">
                        No expenses yet
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </LayoutSection>

            <LayoutSection id="reports.comparison">
              <LayoutParts sectionId="reports.comparison">
                <Card className="frost">
                  <LayoutPart id="reports.comparison.toolbar">
                    <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
                      <CardTitle className="page-title text-base">
                        {monthLabel(month)} vs {monthLabel(prevMonthKey(month))}
                      </CardTitle>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={exportPdf}>
                          <FileText className="h-4 w-4" /> PDF statement
                        </Button>
                        <Button size="sm" variant="outline" onClick={sharePdf}>
                          <FileText className="h-4 w-4" /> Share
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline">
                              <FileDown className="h-4 w-4" /> Export Excel{" "}
                              <ChevronDown className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={exportReport}>
                              This month
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => void exportFullReport()}
                            >
                              All time (full history)
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardHeader>
                  </LayoutPart>
                  <LayoutPart id="reports.comparison.tiles">
                    <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                      {compareCards.map((c) => (
                        <div
                          key={c.label}
                          className="frost-soft lift rounded-lg border p-3"
                        >
                          <p className="micro-label text-muted-foreground">
                            {c.label}
                          </p>
                          <p className="stat-value mt-0.5 text-lg leading-tight">
                            {money(c.value)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            was {money(c.previous)}
                          </p>
                          <DeltaStat change={c.change} invert={c.invert} />
                        </div>
                      ))}
                    </CardContent>
                  </LayoutPart>
                </Card>
              </LayoutParts>
            </LayoutSection>

            <LayoutSection id="reports.pnl-table">
              <Card className="frost">
                <CardHeader className="pb-2">
                  <CardTitle className="page-title text-base">
                    Profit &amp; loss by month
                  </CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="py-2">Month</th>
                        <th className="py-2 text-right">Revenue (incl. tax)</th>
                        <th className="py-2 text-right">Expenses</th>
                        <th className="py-2 text-right">Profit</th>
                        <th className="py-2 text-right">Dues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pnl.map((r) => (
                        <tr key={r.key} className="border-t">
                          <td className="py-2">{r.month}</td>
                          <td className="py-2 text-right">
                            {money(r.Revenue)}
                          </td>
                          <td className="py-2 text-right">
                            {money(r.Expenses)}
                          </td>
                          <td
                            className={
                              r.Profit < 0
                                ? "py-2 text-right font-semibold text-destructive"
                                : "py-2 text-right font-semibold"
                            }
                          >
                            {money(r.Profit)}
                          </td>
                          <td className="py-2 text-right">{money(r.Dues)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </LayoutSection>

            <LayoutSection id="reports.profit-mix">
              <ProfitMixCard
                turf={cur.turfRevenue}
                snacks={cur.snacksRevenue}
                bills={cur.billsRevenue}
                expenses={cur.expenses}
                profit={cur.profit}
                subtitle={monthLabel(month)}
              />
            </LayoutSection>

            <LayoutSection id="reports.turf-usage">
              <TurfUsageDetailCard occupancy={occupancy} />
            </LayoutSection>

            <LayoutSection id="reports.top-customers">
              <TopCustomersCard ranking={ranking} />
            </LayoutSection>

            <LayoutSection id="reports.item-insights">
              <ItemPerformanceCard performance={itemPerf} />
            </LayoutSection>

            <LayoutSection id="reports.revenue-by-source">
              <Card className="frost">
                <CardHeader className="pb-2">
                  <CardTitle className="page-title text-base">
                    Revenue by source · last 6 months
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-64 px-2 md:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={revenueTrend}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="month" fontSize={11} />
                      <YAxis yAxisId="money" fontSize={11} width={44} />
                      <YAxis
                        yAxisId="pct"
                        orientation="right"
                        fontSize={11}
                        width={40}
                        tickFormatter={(v: number) => `${v}%`}
                      />
                      <Tooltip
                        formatter={(v: number, name: string) =>
                          name === "Margin" ? `${v.toFixed(1)}%` : money(v)
                        }
                      />
                      <Legend />
                      <Bar
                        yAxisId="money"
                        dataKey="Bills"
                        name="Bills"
                        stackId="rev"
                        fill="var(--chart-4)"
                        radius={0}
                      />
                      <Bar
                        yAxisId="money"
                        dataKey="Turf"
                        name="Turf"
                        stackId="rev"
                        fill="var(--chart-1)"
                        radius={0}
                      />
                      <Bar
                        yAxisId="money"
                        dataKey="Snacks"
                        name="Snacks"
                        stackId="rev"
                        fill="var(--chart-2)"
                        radius={4}
                      />
                      <Line
                        yAxisId="pct"
                        type="monotone"
                        dataKey="Margin"
                        name="Profit margin"
                        stroke="var(--chart-5)"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </LayoutSection>

            <LayoutSection id="reports.expense-trend">
              <Card className="frost">
                <CardHeader className="pb-2">
                  <CardTitle className="page-title text-base">
                    Expenses · last 6 months
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-56 px-2 md:h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={expenseTrend}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="month" fontSize={11} />
                      <YAxis fontSize={11} width={44} />
                      <Tooltip formatter={(v: number) => money(v)} />
                      <Bar
                        dataKey="Expenses"
                        fill="var(--chart-3)"
                        radius={4}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </LayoutSection>

            <LayoutSection id="reports.snack-share">
              <Card className="frost">
                <CardHeader className="pb-2">
                  <CardTitle className="page-title text-base">
                    Snack revenue share
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-64 px-2 md:h-80">
                  {pieData.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">
                      No snack sales this month.
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="value"
                          nameKey="name"
                          outerRadius="75%"
                          label
                        >
                          {pieData.map((_, i) => (
                            <Cell
                              key={i}
                              fill={PIE_COLORS[i % PIE_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => money(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </LayoutSection>

            <LayoutSection id="reports.item-sales">
              <LayoutParts sectionId="reports.item-sales">
                <Card className="frost">
                  <LayoutPart id="reports.item-sales.toolbar">
                    <CardHeader className="flex-col items-stretch gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
                      <CardTitle className="page-title text-base">
                        Item-wise sales
                      </CardTitle>
                      <div className="flex flex-wrap gap-2">
                        <SortMenu
                          options={ITEM_SORT_OPTIONS}
                          field={itemSort.field}
                          dir={itemSort.dir}
                          onFieldChange={itemSort.setField}
                          onToggleDir={itemSort.toggleDir}
                        />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline">
                              <FileDown className="h-4 w-4" /> Excel{" "}
                              <ChevronDown className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() =>
                                exportToExcel(
                                  itemRows.map((r) => ({
                                    Item: r.name,
                                    Qty: r.qty,
                                    Revenue: r.revenue,
                                    Profit: r.profit,
                                  })),
                                  `items-${month}-${sortSuffix(itemSort.field, itemSort.dir)}`,
                                  "Items",
                                  INVOICE_SECTIONS.reports,
                                )
                              }
                            >
                              This month
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                // Same "aggregate across every record" approach as the
                                // main Export Excel menu's "All time" — matches() always
                                // true, so itemPerformance sums every sale ever loaded
                                // instead of just this month's.
                                const allTime = itemPerformance(
                                  sales,
                                  () => true,
                                );
                                void exportToExcel(
                                  allTime.rows.map((r) => ({
                                    Item: r.name,
                                    Qty: r.qty,
                                    Revenue: r.revenue,
                                    Profit: r.profit,
                                  })),
                                  `items-full-history`,
                                  "Items",
                                  INVOICE_SECTIONS.reports,
                                );
                              }}
                            >
                              All time (full history)
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardHeader>
                  </LayoutPart>
                  <LayoutPart id="reports.item-sales.table">
                    <CardContent>
                      {itemRows.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No snack sales this month.
                        </p>
                      ) : isMobile ? (
                        <div className="space-y-2">
                          {itemRows.map((r) => (
                            <div
                              key={r.name}
                              className="frost-soft lift rounded-lg border p-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium">{r.name}</p>
                                <p className="stat-value text-sm">
                                  {money(r.revenue)}
                                </p>
                              </div>
                              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                                <span>Qty {r.qty}</span>
                                <span
                                  className={
                                    r.profit < 0
                                      ? "font-medium text-destructive"
                                      : "font-medium"
                                  }
                                >
                                  Profit {money(r.profit)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-muted-foreground">
                                <th className="py-2">Item</th>
                                <th className="py-2 text-right">Qty</th>
                                <th className="py-2 text-right">Revenue</th>
                                <th className="py-2 text-right">Profit</th>
                              </tr>
                            </thead>
                            <tbody>
                              {itemRows.map((r) => (
                                <tr key={r.name} className="border-t">
                                  <td className="py-2">{r.name}</td>
                                  <td className="py-2 text-right">{r.qty}</td>
                                  <td className="py-2 text-right">
                                    {money(r.revenue)}
                                  </td>
                                  <td className="py-2 text-right">
                                    {money(r.profit)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </CardContent>
                  </LayoutPart>
                </Card>
              </LayoutParts>
            </LayoutSection>

            <LayoutSection id="reports.turf-dues">
              <LayoutParts sectionId="reports.turf-dues">
                <Accordion
                  type="multiple"
                  value={duesSectionOpen}
                  onValueChange={setDuesSectionOpen}
                >
                  <SettingsSection
                    value="turf-dues"
                    eyebrow="OUTSTANDING"
                    title="Turf dues"
                    icon={Wallet2}
                    action={
                      <LayoutPart id="reports.turf-dues.toolbar">
                        {dues.length > 0 ? (
                          <SortMenu
                            options={TURF_DUES_SORT_OPTIONS}
                            field={turfDuesSort.field}
                            dir={turfDuesSort.dir}
                            onFieldChange={turfDuesSort.setField}
                            onToggleDir={turfDuesSort.toggleDir}
                          />
                        ) : null}
                      </LayoutPart>
                    }
                  >
                    <LayoutPart id="reports.turf-dues.list">
                      <div className="space-y-2">
                        {dues.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No pending dues.
                          </p>
                        ) : (
                          sortedDues.map((b) => (
                            <div
                              key={b.id}
                              className="frost-soft lift flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                            >
                              <div>
                                <p className="font-semibold">
                                  {b.booking_no} · {b.customer_name}
                                </p>
                                <p className="text-muted-foreground">
                                  Total {money(b.gross)}
                                  {b.discount > 0 && (
                                    <> · Offer -{money(b.discount)}</>
                                  )}{" "}
                                  · Paid {money(b.cashPaid)}
                                </p>
                                <p className="font-medium text-destructive">
                                  Due {money(b.due)} ·{" "}
                                  {AGE_BUCKET_META[ageBucket(b.booking_date)]}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                disabled={updateBooking.isPending}
                                onClick={() =>
                                  updateBooking.mutate(
                                    {
                                      id: b.id,
                                      // Clear the FULL tax-inclusive due (not the pre-tax
                                      // total, which left a tax-sized balance behind).
                                      advance_paid: b.paid + b.due,
                                      status: "Completed",
                                    },
                                    {
                                      onSuccess: () =>
                                        toast.success("Marked as paid"),
                                    },
                                  )
                                }
                              >
                                <CheckCircle2 className="h-4 w-4" /> Mark paid
                              </Button>
                            </div>
                          ))
                        )}
                      </div>
                    </LayoutPart>
                  </SettingsSection>
                </Accordion>
              </LayoutParts>
            </LayoutSection>
          </>
        )}
      </LayoutSections>
    </div>
  );
}
