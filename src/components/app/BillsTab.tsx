import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileDown,
  Receipt,
  Trash2,
  Ban,
  Users,
} from "lucide-react";
import { exportToExcel } from "@/lib/xlsx";
import { INVOICE_SECTIONS } from "@/lib/desktop";
import {
  paymentStateLabel,
  paymentStateBadgeClass,
} from "@/lib/payment-status";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  balanceOf,
  billGrossTotal,
  billPaidAmount,
  formatDMY,
  money,
  type Bill,
  type BillStatus,
} from "@/lib/biz";
import {
  useBills,
  useDeleteBill,
  useUnmergeBill,
  useUpdateBill,
  useVoidBill,
} from "@/lib/data";
import {
  billDue,
  billMovedToDues,
  customerOutstanding,
  dueNoForRef,
} from "@/lib/dues";
import { useSnackSales, useTurfBookings } from "@/lib/ops";
import { TAB_REF_BILL, useTabEntries } from "@/lib/tabs";
import { dayKey } from "@/lib/analytics";
import {
  compareBy,
  sortSuffix,
  useSortState,
  type SortOption,
} from "@/lib/sort";
import { BillActions } from "./BillActions";
import { MergeBillDialog } from "./MergeBillDialog";
import { TodaySummaryCard } from "./TodaySummaryCard";
import { QuickPayRow } from "./QuickPayRow";
import { CustomerDetailDialog } from "./CustomerDetailDialog";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";
import { ListDisclosure } from "./ListDisclosure";
import { SectionHeading } from "./SectionHeading";
import { SortMenu } from "./SortMenu";
import {
  LayoutSection,
  LayoutSections,
  LayoutPart,
  LayoutParts,
} from "./LayoutSection";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

type BillSortField = "date" | "customer" | "balance" | "total";

const BILL_SORT_OPTIONS: SortOption<BillSortField>[] = [
  { value: "date", label: "Date", defaultDir: "desc" },
  { value: "customer", label: "Customer", defaultDir: "asc" },
  { value: "balance", label: "Balance due", defaultDir: "desc" },
  { value: "total", label: "Total", defaultDir: "desc" },
];

type LedgerSortField = "due" | "name" | "date";

const LEDGER_SORT_OPTIONS: SortOption<LedgerSortField>[] = [
  { value: "due", label: "Balance due", defaultDir: "desc" },
  { value: "name", label: "Name (A–Z)", defaultDir: "asc" },
  { value: "date", label: "Most recent bill", defaultDir: "desc" },
];

export function BillsTab() {
  const { data: bills = [] } = useBills();
  const updateBill = useUpdateBill();
  const deleteBill = useDeleteBill();
  const unmergeBillMut = useUnmergeBill();
  const voidBillMut = useVoidBill();
  const { data: tabEntries = [] } = useTabEntries();
  const { data: allBookings = [] } = useTurfBookings();
  const { data: allSales = [] } = useSnackSales();

  /** Bill ids that own merged source records — those can be un-merged. */
  const mergedBillIds = useMemo(() => {
    const ids = new Set<string>();
    for (const b of allBookings)
      if (b.merged_into_bill_id) ids.add(b.merged_into_bill_id);
    for (const s of allSales)
      if (s.merged_into_bill_id) ids.add(s.merged_into_bill_id);
    return ids;
  }, [allBookings, allSales]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | BillStatus>("all");
  const [openCustomer, setOpenCustomer] = useState<{
    name: string;
    phone: string | null;
  } | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  /** Set by the calendar-popup on the "Date" sort control — narrows the
   * invoice list to exactly one day, regardless of the From/To range above. */
  const [pickedDate, setPickedDate] = useState<string | undefined>(undefined);
  const sort = useSortState<BillSortField>("bills", BILL_SORT_OPTIONS, {
    field: "date",
    dir: "desc",
  });
  const ledgerSort = useSortState<LedgerSortField>(
    "bills-ledger",
    LEDGER_SORT_OPTIONS,
    {
      field: "due",
      dir: "desc",
    },
  );

  const filtered = useMemo(
    () =>
      bills
        .filter((b) => {
          if (
            q &&
            !b.customer_name.toLowerCase().includes(q.toLowerCase()) &&
            !b.invoice_no.includes(q)
          )
            return false;
          if (status !== "all" && b.status !== status) return false;
          const d = dayKey(b.bill_date);
          if (pickedDate && d !== pickedDate) return false;
          if (from && d < from) return false;
          if (to && d > to) return false;
          return true;
        })
        .sort((a, b) => {
          switch (sort.field) {
            case "customer":
              return compareBy(
                a.customer_name.toLowerCase(),
                b.customer_name.toLowerCase(),
                sort.dir,
              );
            case "balance":
              return compareBy(balanceOf(a), balanceOf(b), sort.dir);
            case "total":
              return compareBy(billGrossTotal(a), billGrossTotal(b), sort.dir);
            case "date":
            default:
              return compareBy(
                dayKey(a.bill_date),
                dayKey(b.bill_date),
                sort.dir,
              );
          }
        }),
    [bills, q, status, from, to, pickedDate, sort.field, sort.dir],
  );

  const PAGE_SIZE = 25;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageBills = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  useEffect(() => {
    setPage(1);
  }, [q, status, from, to, pickedDate, sort.field, sort.dir, bills.length]);

  /**
   * Per-customer outstanding, from the ONE dues engine (lib/dues.ts) so this
   * list agrees with Turf, Dues and Reports: a bill settled "On tab" is owed
   * on the tab, not here, and is never counted twice.
   */
  const ledger = useMemo(() => {
    const seen = new Map<
      string,
      { name: string; phone: string | null; lastBillDate: string }
    >();
    for (const b of bills) {
      const key = b.customer_name.toLowerCase();
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, {
          name: b.customer_name,
          phone: b.customer_phone,
          lastBillDate: b.bill_date,
        });
      } else if (b.bill_date > existing.lastBillDate) {
        existing.lastBillDate = b.bill_date;
      }
    }
    return [...seen.values()]
      .map((c) => ({
        ...c,
        due: customerOutstanding(c, {
          bills,
          bookings: allBookings,
          tabEntries,
        }).total,
      }))
      .filter((c) => c.due > 0)
      .sort((a, b) => {
        switch (ledgerSort.field) {
          case "name":
            return compareBy(
              a.name.toLowerCase(),
              b.name.toLowerCase(),
              ledgerSort.dir,
            );
          case "date":
            return compareBy(a.lastBillDate, b.lastBillDate, ledgerSort.dir);
          case "due":
          default:
            return compareBy(a.due, b.due, ledgerSort.dir);
        }
      });
  }, [bills, allBookings, tabEntries, ledgerSort.field, ledgerSort.dir]);

  const [selected, setSelected] = useState<string[]>([]);
  const toggleSelect = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  const isMobile = useIsMobile();
  /** Which bill's full card shows in the desktop two-pane's right column.
   * Mobile ignores this entirely — every bill's full card renders inline in
   * the list there, same as before this pass. */
  const [activeBillId, setActiveBillId] = useState<string | null>(null);
  /** Right-click ("Delete") on a desktop two-pane row goes through this
   * confirm dialog rather than mutating straight away, same gate every
   * other delete in the app uses (see `ConfirmDeleteButton`) — a context
   * menu selection is just as easy to mis-click as a stray tap. */
  const [deleteTarget, setDeleteTarget] = useState<Bill | null>(null);
  /** Same reasoning as `deleteTarget` — a right-click "Void bill" goes
   * through this confirm dialog rather than mutating straight away. */
  const [voidTarget, setVoidTarget] = useState<Bill | null>(null);

  const OVERDUE_DAYS = 7;
  const isOverdue = (b: Bill) =>
    balanceOf(b) > 0 &&
    (Date.now() - new Date(b.bill_date).getTime()) / 86400000 > OVERDUE_DAYS;

  const billsToRows = (list: Bill[]) =>
    list.map((b) => ({
      Invoice: b.invoice_no,
      Date: formatDMY(b.bill_date),
      Customer: b.customer_name,
      Phone: b.customer_phone ?? "",
      Total: billGrossTotal(b),
      Paid: billPaidAmount(b),
      Balance: balanceOf(b),
      Status: b.status,
    }));

  const bulkMarkPaid = async () => {
    const list = bills.filter((b) => selected.includes(b.id));
    let done = 0;
    try {
      for (const b of list) {
        await updateBill.mutateAsync({
          id: b.id,
          status: "paid",
          amount_paid: billGrossTotal(b),
        });
        done += 1;
      }
      setSelected([]);
      toast.success(`${list.length} bills marked paid`);
    } catch (e) {
      // Leave the still-unpaid bills selected so the user can see and retry
      // exactly what didn't go through, instead of the selection silently
      // clearing on a partial failure.
      setSelected((prev) =>
        prev.filter((id) => !list.slice(0, done).some((b) => b.id === id)),
      );
      toast.error(
        done > 0
          ? `Marked ${done} of ${list.length} paid, then stopped: ${(e as Error).message}`
          : `Couldn't mark bills paid: ${(e as Error).message}`,
      );
    }
  };

  const bulkExport = () => {
    exportToExcel(
      billsToRows(bills.filter((b) => selected.includes(b.id))),
      "bills-selected",
      "Bills",
      INVOICE_SECTIONS.bills,
    );
  };

  const setPayment = async (bill: Bill, next: BillStatus) => {
    try {
      await updateBill.mutateAsync({
        id: bill.id,
        status: next,
        amount_paid:
          next === "paid"
            ? billGrossTotal(bill)
            : next === "unpaid"
              ? 0
              : bill.amount_paid,
      });
      toast.success(`Marked ${next}`);
    } catch (e) {
      toast.error(`Couldn't update status: ${(e as Error).message}`);
    }
  };

  /**
   * The full bill card — header, item lines, payable/paid/due, quick-pay,
   * bill actions, un-merge, status select, delete. Extracted to a closure
   * (rather than a separate top-level component) purely so it can be
   * called from two different places below — the mobile inline list and
   * the desktop two-pane's right column — without duplicating any of this
   * markup or logic. Behavior is byte-for-byte what this used to be inline
   * in `pageBills.map(...)`.
   */
  const renderBillCard = (bill: Bill) => {
    const moved = billMovedToDues(bill, tabEntries);
    const cancelled = bill.status === "cancelled";
    const dueNo = moved
      ? dueNoForRef(
          tabEntries,
          TAB_REF_BILL,
          bill.id,
          bill.invoice_no,
          bill.bill_date,
        )
      : null;
    return (
      <Card
        key={bill.id}
        className={`${isOverdue(bill) ? "lift border-destructive/50 bg-destructive/5" : "lift"} ${
          moved || cancelled ? "opacity-60 saturate-50" : ""
        }`}
      >
        <CardContent className="space-y-3 pt-5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <Checkbox
                className="mt-1"
                aria-label="Select bill"
                checked={selected.includes(bill.id)}
                disabled={moved || cancelled}
                onCheckedChange={() => toggleSelect(bill.id)}
              />
              <div>
                <p className="font-semibold">
                  {bill.invoice_no} ·{" "}
                  <button
                    type="button"
                    className="underline decoration-dotted underline-offset-2"
                    onClick={() =>
                      setOpenCustomer({
                        name: bill.customer_name,
                        phone: bill.customer_phone,
                      })
                    }
                  >
                    {bill.customer_name}
                  </button>
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDMY(bill.bill_date)}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge className={paymentStateBadgeClass(bill.status)}>
                {paymentStateLabel(bill.status)}
              </Badge>
              {isOverdue(bill) && (
                <Badge
                  variant="outline"
                  className="border-destructive text-destructive"
                >
                  Overdue
                </Badge>
              )}
              {moved && dueNo ? (
                <Badge variant="secondary">Moved to dues · {dueNo}</Badge>
              ) : (
                bill.payment_mode === "On tab" && (
                  <Badge variant="secondary">On tab</Badge>
                )
              )}
              {mergedBillIds.has(bill.id) && (
                <Badge variant="outline">Merged</Badge>
              )}
            </div>
          </div>
          <ul className="space-y-1 text-sm">
            {bill.items.map((it, i) => (
              <li
                key={i}
                className="flex justify-between text-muted-foreground"
              >
                <span>
                  {it.item} · {it.qty} {it.unit ?? "kg"} × {money(it.rate)}
                </span>
                <span className="text-foreground">{money(it.total)}</span>
              </li>
            ))}
          </ul>
          <div className="frost-well flex items-center justify-between rounded-xl border p-3">
            <span className="text-sm text-muted-foreground">
              {bill.discount > 0 ? `Offer -${money(bill.discount)}` : "Payable"}
            </span>
            <span className="stat-value text-xl text-primary">
              {money(billGrossTotal(bill))}
            </span>
          </div>
          {billGrossTotal(bill) > bill.total && (
            <p className="text-right text-xs text-muted-foreground">
              incl. tax {money(billGrossTotal(bill) - bill.total)}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Paid {money(billPaidAmount(bill))}
            {billDue(bill, tabEntries) > 0 && (
              <span className="font-medium text-destructive">
                {" "}
                · Due {money(billDue(bill, tabEntries))}
              </span>
            )}
            {billDue(bill, tabEntries) === 0 && balanceOf(bill) > 0 && (
              <span> · balance owed on the customer's tab</span>
            )}
          </p>
          {bill.payment_mode && bill.status === "paid" && (
            <p className="text-sm text-muted-foreground">
              Paid via {bill.payment_mode}
            </p>
          )}
          {cancelled ? (
            <p className="frost-soft rounded-xl border px-3 py-2 text-xs text-muted-foreground">
              This bill was cancelled — it doesn't count toward revenue or any
              customer's due.
            </p>
          ) : moved ? (
            <p className="frost-soft rounded-xl border px-3 py-2 text-xs text-muted-foreground">
              This bill's balance is on the customer's tab — collect it from
              Outstanding.
            </p>
          ) : (
            <QuickPayRow bill={bill} allowUpi={!mergedBillIds.has(bill.id)} />
          )}
          <BillActions
            bill={bill}
            section={
              mergedBillIds.has(bill.id)
                ? INVOICE_SECTIONS.merged
                : INVOICE_SECTIONS.bills
            }
            restricted={moved || cancelled}
          />
          {mergedBillIds.has(bill.id) && !cancelled && (
            <Button
              variant="outline"
              className="w-full"
              disabled={moved || unmergeBillMut.isPending}
              onClick={() =>
                unmergeBillMut.mutate(bill.id, {
                  onSuccess: () =>
                    toast.success(
                      "Un-merged · dues are back on the original records",
                    ),
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              Un-merge {bill.invoice_no}
            </Button>
          )}
          {cancelled ? (
            <ConfirmDeleteButton
              className="w-full text-destructive"
              ariaLabel="Delete cancelled bill"
              title={`Delete ${bill.invoice_no}?`}
              description={`This permanently removes the cancelled record for ${bill.customer_name} and can't be undone.`}
              onConfirm={() =>
                deleteBill.mutate(bill.id, {
                  onSuccess: () => toast.success("Bill deleted"),
                  onError: (e) => toast.error(e.message),
                })
              }
            />
          ) : (
            <div className="flex gap-2">
              <Select
                value={bill.status}
                disabled={moved}
                onValueChange={(v) => setPayment(bill, v as BillStatus)}
              >
                <SelectTrigger className="h-12! flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Mark paid</SelectItem>
                  <SelectItem value="unpaid">Mark unpaid</SelectItem>
                  <SelectItem value="partial">Partially paid</SelectItem>
                </SelectContent>
              </Select>
              <ConfirmDeleteButton
                size="icon"
                className="size-12 text-muted-foreground"
                iconClassName="size-5"
                ariaLabel="Void bill"
                icon={Ban}
                confirmLabel="Void bill"
                title={`Void bill ${bill.invoice_no}?`}
                description={`This cancels ${bill.invoice_no} for ${bill.customer_name} — any merged bookings or snack bills go back to owing their own balance, and it stops counting toward revenue or dues. The record stays for history; this doesn't delete it.`}
                disabled={moved}
                onConfirm={() =>
                  voidBillMut.mutate(bill.id, {
                    onSuccess: () =>
                      toast.success(`${bill.invoice_no} cancelled`),
                    onError: (e) => toast.error(e.message),
                  })
                }
              />
              <ConfirmDeleteButton
                size="icon"
                className="size-12 text-destructive"
                iconClassName="size-5"
                ariaLabel="Delete bill"
                title={`Delete bill ${bill.invoice_no}?`}
                description={`This permanently removes ${bill.invoice_no} for ${bill.customer_name} and can't be undone.`}
                disabled={moved}
                onConfirm={() =>
                  deleteBill.mutate(bill.id, {
                    onSuccess: () => toast.success("Bill deleted"),
                    onError: (e) => toast.error(e.message),
                  })
                }
              />
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const activeBill = pageBills.find((b) => b.id === activeBillId) ?? null;

  return (
    <div className="space-y-6">
      <SectionHeading eyebrow="BILLS & MONEY" title="Bills" icon={Receipt} />

      <MergeBillDialog />
      <CustomerDetailDialog
        name={openCustomer?.name ?? null}
        phone={openCustomer?.phone ?? null}
        onOpenChange={(o) => !o && setOpenCustomer(null)}
      />

      <LayoutSections tabId="bills" className="space-y-6">
        <LayoutSection id="bills.today-summary">
          <TodaySummaryCard />
        </LayoutSection>

        <LayoutSection id="bills.search-filter">
          <section className="space-y-3">
            <SectionHeading eyebrow="FILTER" title="Search & filter" />
            <Card className="frost">
              <CardContent className="space-y-3 pt-5">
                <LayoutParts
                  sectionId="bills.search-filter"
                  className="space-y-3"
                >
                  <LayoutPart id="bills.search-filter.search">
                    <Input
                      className="h-12"
                      placeholder="Search customer or invoice no."
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      data-shortcut="search"
                    />
                  </LayoutPart>
                  <LayoutParts
                    sectionId="bills.search-filter"
                    className="grid gap-2 sm:grid-cols-3"
                  >
                    <LayoutPart id="bills.search-filter.status">
                      <Label className="text-xs text-muted-foreground">
                        Status
                      </Label>
                      <Select
                        value={status}
                        onValueChange={(v) =>
                          setStatus(v as "all" | BillStatus)
                        }
                      >
                        <SelectTrigger className="h-12! w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="paid">Paid</SelectItem>
                          <SelectItem value="unpaid">Unpaid</SelectItem>
                          <SelectItem value="partial">Partial</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                    </LayoutPart>
                    <LayoutPart
                      id="bills.search-filter.date"
                      className="grid gap-2 min-[420px]:grid-cols-2 sm:col-span-2"
                    >
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          From
                        </Label>
                        <Input
                          className="h-12"
                          type="date"
                          value={from}
                          onChange={(e) => setFrom(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          To
                        </Label>
                        <Input
                          className="h-12"
                          type="date"
                          value={to}
                          onChange={(e) => setTo(e.target.value)}
                        />
                      </div>
                    </LayoutPart>
                  </LayoutParts>
                  <LayoutPart
                    id="bills.search-filter.sort"
                    className="space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-xs text-muted-foreground">
                        Sort by
                      </Label>
                      <SortMenu
                        options={BILL_SORT_OPTIONS}
                        field={sort.field}
                        dir={sort.dir}
                        onFieldChange={sort.setField}
                        onToggleDir={sort.toggleDir}
                        dateField="date"
                        selectedDate={pickedDate}
                        onSelectDate={setPickedDate}
                      />
                    </div>
                    {pickedDate && (
                      <div className="frost-soft flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm">
                        <span>
                          Showing{" "}
                          <span className="font-medium">{filtered.length}</span>{" "}
                          invoice
                          {filtered.length === 1 ? "" : "s"} for{" "}
                          <span className="font-medium">
                            {formatDMY(pickedDate)}
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPickedDate(undefined)}
                        >
                          Clear
                        </Button>
                      </div>
                    )}
                  </LayoutPart>
                  <LayoutPart id="bills.search-filter.export">
                    <Button
                      variant="outline"
                      className="h-12 w-full"
                      onClick={() =>
                        exportToExcel(
                          filtered.map((b) => ({
                            Invoice: b.invoice_no,
                            Date: formatDMY(b.bill_date),
                            Customer: b.customer_name,
                            Phone: b.customer_phone ?? "",
                            Subtotal: Number(b.subtotal) || 0,
                            Discount: Number(b.discount) || 0,
                            Total: billGrossTotal(b),
                            Paid: billPaidAmount(b),
                            Balance: balanceOf(b),
                            Status: b.status,
                          })),
                          `bills-${sortSuffix(sort.field, sort.dir)}`,
                          "Bills",
                          INVOICE_SECTIONS.bills,
                        )
                      }
                    >
                      <FileDown className="size-4" /> Export to Excel
                    </Button>
                  </LayoutPart>
                </LayoutParts>
              </CardContent>
            </Card>
          </section>
        </LayoutSection>

        <LayoutSection id="bills.ledger">
          {ledger.length > 0 && (
            <section className="space-y-3">
              <LayoutParts sectionId="bills.ledger" className="space-y-3">
                <LayoutPart id="bills.ledger.heading">
                  <SectionHeading
                    eyebrow="LEDGER"
                    title="Pending by customer"
                    icon={Users}
                    action={
                      <SortMenu
                        options={LEDGER_SORT_OPTIONS}
                        field={ledgerSort.field}
                        dir={ledgerSort.dir}
                        onFieldChange={ledgerSort.setField}
                        onToggleDir={ledgerSort.toggleDir}
                      />
                    }
                  />
                </LayoutPart>
                <LayoutPart id="bills.ledger.table">
                  <Card className="frost">
                    <CardContent className="pt-5">
                      <ul className="space-y-2">
                        {ledger.map((c) => (
                          <li key={c.name}>
                            <button
                              type="button"
                              className="frost-soft lift flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm"
                              onClick={() =>
                                setOpenCustomer({
                                  name: c.name,
                                  phone: c.phone,
                                })
                              }
                            >
                              <span className="min-w-0 truncate">
                                {c.name}
                                {c.phone ? (
                                  <span className="text-muted-foreground">
                                    {" "}
                                    · {c.phone}
                                  </span>
                                ) : null}
                              </span>
                              <span className="stat-value shrink-0 text-sm text-destructive">
                                {money(c.due)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </LayoutPart>
              </LayoutParts>
            </section>
          )}
        </LayoutSection>

        <LayoutSection id="bills.list">
          <>
            {filtered.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No bills yet.
              </p>
            )}

            <LayoutParts sectionId="bills.list" className="space-y-6">
              <LayoutPart id="bills.list.bulk">
                {selected.length > 0 && (
                  <Card className="frost border-primary/40">
                    <CardContent className="flex flex-wrap items-center gap-2 pt-5">
                      <span className="text-sm font-medium">
                        {selected.length} selected
                      </span>
                      <Button className="h-10" onClick={bulkMarkPaid}>
                        Mark paid
                      </Button>
                      <Button
                        variant="outline"
                        className="h-10"
                        onClick={bulkExport}
                      >
                        <FileDown className="size-4" /> Export
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-10"
                        onClick={() => setSelected([])}
                      >
                        Clear
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </LayoutPart>

              <LayoutPart id="bills.list.heading">
                {pageBills.length > 0 && (
                  <SectionHeading eyebrow="INVOICES" title="All bills" />
                )}
              </LayoutPart>

              <LayoutPart id="bills.list.items" className="space-y-3">
                {isMobile ? (
                  <ListDisclosure
                    storageKey="bills.all"
                    label="All bills"
                    count={filtered.length}
                  >
                    <section className="space-y-3">
                      {pageBills.map(renderBillCard)}
                    </section>
                    {filtered.length > PAGE_SIZE && (
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <Button
                          variant="outline"
                          className="h-12"
                          disabled={safePage <= 1}
                          onClick={() => setPage(safePage - 1)}
                        >
                          <ChevronLeft className="size-4" /> Prev
                        </Button>
                        <p className="text-sm text-muted-foreground">
                          Page {safePage} of {pageCount} · {filtered.length}{" "}
                          bills
                        </p>
                        <Button
                          variant="outline"
                          className="h-12"
                          disabled={safePage >= pageCount}
                          onClick={() => setPage(safePage + 1)}
                        >
                          Next <ChevronRight className="size-4" />
                        </Button>
                      </div>
                    )}
                  </ListDisclosure>
                ) : (
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-start gap-4">
                    <div className="min-w-0 space-y-3">
                      <Card className="frost">
                        <CardContent className="space-y-1.5 pt-5">
                          {pageBills.map((bill) => {
                            const moved = billMovedToDues(bill, tabEntries);
                            const cancelled = bill.status === "cancelled";
                            const row = (
                              <div
                                className={cn(
                                  "frost-soft flex items-center gap-2 rounded-xl border p-2.5",
                                  activeBillId === bill.id
                                    ? "border-primary/50 ring-1 ring-primary/30"
                                    : undefined,
                                  moved || cancelled
                                    ? "opacity-60 saturate-50"
                                    : undefined,
                                )}
                              >
                                <Checkbox
                                  aria-label="Select bill"
                                  checked={selected.includes(bill.id)}
                                  disabled={moved || cancelled}
                                  onCheckedChange={() => toggleSelect(bill.id)}
                                />
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 text-left"
                                  onClick={() => setActiveBillId(bill.id)}
                                >
                                  <p className="truncate text-sm font-medium">
                                    {bill.invoice_no} · {bill.customer_name}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {formatDMY(bill.bill_date)}
                                    {balanceOf(bill) > 0
                                      ? ` · Balance ${money(balanceOf(bill))}`
                                      : ""}
                                  </p>
                                </button>
                                <Badge
                                  className={cn(
                                    paymentStateBadgeClass(bill.status),
                                    "shrink-0",
                                  )}
                                >
                                  {paymentStateLabel(bill.status)}
                                </Badge>
                              </div>
                            );
                            return (
                              <ContextMenu key={bill.id}>
                                <ContextMenuTrigger asChild>
                                  {row}
                                </ContextMenuTrigger>
                                <ContextMenuContent>
                                  <ContextMenuItem
                                    onSelect={() => setActiveBillId(bill.id)}
                                  >
                                    Open
                                  </ContextMenuItem>
                                  <ContextMenuSeparator />
                                  <ContextMenuItem
                                    disabled={
                                      moved ||
                                      cancelled ||
                                      bill.status === "paid"
                                    }
                                    onSelect={() => setPayment(bill, "paid")}
                                  >
                                    Mark paid
                                  </ContextMenuItem>
                                  <ContextMenuItem
                                    disabled={
                                      moved ||
                                      cancelled ||
                                      bill.status === "unpaid"
                                    }
                                    onSelect={() => setPayment(bill, "unpaid")}
                                  >
                                    Mark unpaid
                                  </ContextMenuItem>
                                  <ContextMenuItem
                                    disabled={
                                      moved ||
                                      cancelled ||
                                      bill.status === "partial"
                                    }
                                    onSelect={() => setPayment(bill, "partial")}
                                  >
                                    Mark partially paid
                                  </ContextMenuItem>
                                  <ContextMenuSeparator />
                                  <ContextMenuItem
                                    disabled={moved}
                                    onSelect={() => toggleSelect(bill.id)}
                                  >
                                    {selected.includes(bill.id)
                                      ? "Remove from selection"
                                      : "Add to selection"}
                                  </ContextMenuItem>
                                  <ContextMenuSeparator />
                                  {!cancelled && (
                                    <ContextMenuItem
                                      disabled={moved}
                                      onSelect={() => setVoidTarget(bill)}
                                    >
                                      <Ban className="size-4" /> Void bill
                                    </ContextMenuItem>
                                  )}
                                  <ContextMenuItem
                                    disabled={moved}
                                    className="text-destructive focus:text-destructive"
                                    onSelect={() => setDeleteTarget(bill)}
                                  >
                                    <Trash2 className="size-4" /> Delete
                                  </ContextMenuItem>
                                </ContextMenuContent>
                              </ContextMenu>
                            );
                          })}
                          {pageBills.length === 0 && (
                            <p className="py-6 text-center text-sm text-muted-foreground">
                              No bills match this filter.
                            </p>
                          )}
                        </CardContent>
                      </Card>
                      {filtered.length > PAGE_SIZE && (
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <Button
                            variant="outline"
                            className="h-12"
                            disabled={safePage <= 1}
                            onClick={() => setPage(safePage - 1)}
                          >
                            <ChevronLeft className="size-4" /> Prev
                          </Button>
                          <p className="text-sm text-muted-foreground">
                            Page {safePage} of {pageCount} · {filtered.length}{" "}
                            bills
                          </p>
                          <Button
                            variant="outline"
                            className="h-12"
                            disabled={safePage >= pageCount}
                            onClick={() => setPage(safePage + 1)}
                          >
                            Next <ChevronRight className="size-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="sticky top-24 min-w-0">
                      {activeBill ? (
                        renderBillCard(activeBill)
                      ) : (
                        <Card className="frost-well border-dashed">
                          <CardContent className="flex min-h-[16rem] flex-col items-center justify-center gap-2 pt-5 text-center text-sm text-muted-foreground">
                            <Receipt className="size-6 opacity-50" />
                            <p>
                              Select a bill to see its items, actions and
                              payment status.
                            </p>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </div>
                )}
              </LayoutPart>
            </LayoutParts>
          </>
        </LayoutSection>
      </LayoutSections>

      <AlertDialog
        open={!!voidTarget}
        onOpenChange={(open) => !open && setVoidTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Void bill {voidTarget?.invoice_no}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cancels {voidTarget?.invoice_no} for{" "}
              {voidTarget?.customer_name} — any merged bookings or snack bills
              go back to owing their own balance, and it stops counting toward
              revenue or dues. The record stays for history; this doesn't delete
              it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (voidTarget)
                  voidBillMut.mutate(voidTarget.id, {
                    onSuccess: () =>
                      toast.success(`${voidTarget.invoice_no} cancelled`),
                    onError: (err) => toast.error(err.message),
                  });
                setVoidTarget(null);
              }}
            >
              Void bill
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete bill {deleteTarget?.invoice_no}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {deleteTarget?.invoice_no} for{" "}
              {deleteTarget?.customer_name} and can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget)
                  deleteBill.mutate(deleteTarget.id, {
                    onSuccess: () => toast.success("Bill deleted"),
                    onError: (e) => toast.error(e.message),
                  });
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
