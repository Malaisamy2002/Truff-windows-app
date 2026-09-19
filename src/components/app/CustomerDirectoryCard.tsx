import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Trash2,
  Sparkles,
  Users,
  Trophy,
  Cookie,
  History,
  Pencil,
  FileDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { customerTag, money } from "@/lib/biz";
import { isFinancialBooking } from "@/lib/analytics";
import { customerOutstanding, isFinancialSale } from "@/lib/dues";
import { matchesCustomer, useBills, type CustomerRec } from "@/lib/data";
import { useSnackSales, useTurfBookings } from "@/lib/ops";
import { exportToExcel } from "@/lib/xlsx";
import {
  useCleanupDuplicateCustomers,
  useCustomers,
  useDeleteCustomer,
  useSaveCustomer,
  useUpdateCustomer,
} from "@/lib/data";
import { tabKey, useTabEntries, useTabSummaries } from "@/lib/tabs";
import { compareBy, useSortState, type SortOption } from "@/lib/sort";
import { goToTab } from "@/lib/nav";

import {
  CustomerDetailDialog,
  CustomerDetailContent,
} from "./CustomerDetailDialog";
import { MergeCustomersDialog } from "./MergeCustomersDialog";
import { ListDisclosure } from "./ListDisclosure";
import { SectionHeading } from "./SectionHeading";
import { SortMenu } from "./SortMenu";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

type CustomerSortField = "name" | "recent" | "due";

const CUSTOMER_PAGE_SIZE = 50;

const CUSTOMER_SORT_OPTIONS: SortOption<CustomerSortField>[] = [
  { value: "recent", label: "Recently added", defaultDir: "desc" },
  { value: "name", label: "Name (A–Z)", defaultDir: "asc" },
  { value: "due", label: "Outstanding balance", defaultDir: "desc" },
];

type CustomerRowProps = {
  customer: CustomerRec;
  visits: number;
  due: number;
  tabDue: number;
  isActive: boolean;
  isChecked: boolean;
  isMobile: boolean;
  onToggleSelect: (id: string) => void;
  onOpen: (who: { name: string; phone: string | null }) => void;
  onEdit: (target: { id: string; name: string; phone: string }) => void;
  onDelete: (target: { id: string; name: string }) => void;
};

/**
 * One row of the directory. Memoized (and fed only primitives + stable
 * callbacks) so typing in the search box, ticking a checkbox or paging doesn't
 * re-render — and re-create the Radix context menu for — every row on the
 * page, only the ones whose own data changed.
 */
const CustomerRow = memo(function CustomerRow({
  customer: c,
  visits,
  due,
  tabDue,
  isActive,
  isChecked,
  isMobile,
  onToggleSelect,
  onOpen,
  onEdit,
  onDelete,
}: CustomerRowProps) {
  const tag = customerTag(visits);
  const card = (
    <div
      className={cn(
        "frost-soft lift flex items-center justify-between gap-3 rounded-xl border p-3",
        isActive ? "border-primary/50 ring-1 ring-primary/30" : undefined,
      )}
    >
      <Checkbox
        aria-label="Select customer"
        checked={isChecked}
        onCheckedChange={() => onToggleSelect(c.id)}
      />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() =>
          onOpen({
            name: c.name,
            phone: c.phone ?? null,
          })
        }
      >
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium underline decoration-dotted underline-offset-2">
            {c.name}
          </p>
          <Badge
            variant={
              tag === "VIP"
                ? "default"
                : tag === "Regular"
                  ? "secondary"
                  : "outline"
            }
            className="shrink-0 text-[10px]"
          >
            {tag}
          </Badge>
          {tabDue > 0 && (
            <Badge variant="destructive" className="shrink-0 text-[10px]">
              On tab {money(tabDue)}
            </Badge>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {c.phone || "No phone"} · {visits} visit
          {visits === 1 ? "" : "s"}
          {due > 0 && (
            <span className="text-destructive"> · Due {money(due)}</span>
          )}
        </p>
      </button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => onDelete({ id: c.id, name: c.name })}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );

  // Right-click is desktop-only, same as Bills/Bookings/
  // Outstanding — mobile keeps exactly the plain row it
  // already had (long-press has no equivalent gesture here).
  if (isMobile) return <div>{card}</div>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() =>
            goToTab("turf", {
              name: c.name,
              phone: c.phone ?? null,
            })
          }
        >
          <Trophy className="size-4" /> New booking
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            goToTab("snacks", {
              name: c.name,
              phone: c.phone ?? null,
            })
          }
        >
          <Cookie className="size-4" /> New sale
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() =>
            onOpen({
              name: c.name,
              phone: c.phone ?? null,
            })
          }
        >
          <History className="size-4" /> View history
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            onEdit({
              id: c.id,
              name: c.name,
              phone: c.phone ?? "",
            })
          }
        >
          <Pencil className="size-4" /> Edit
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => onDelete({ id: c.id, name: c.name })}
        >
          <Trash2 className="size-4" /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

export function CustomerDirectoryCard() {
  const { data: customers = [] } = useCustomers();
  const { data: bills = [] } = useBills();
  const { data: bookings = [] } = useTurfBookings();
  const { data: sales = [] } = useSnackSales();
  const save = useSaveCustomer();
  const update = useUpdateCustomer();
  const del = useDeleteCustomer();
  const cleanup = useCleanupDuplicateCustomers();

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ name: "", phone: "" });
  const [openCustomer, setOpenCustomer] = useState<{
    name: string;
    phone: string | null;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  /** Set while the "Edit" row action's dialog is open — the fields are a
   * local draft, only written back to the actual customer on Save. */
  const [editTarget, setEditTarget] = useState<{
    id: string;
    name: string;
    phone: string;
  } | null>(null);
  const isMobile = useIsMobile();

  /**
   * Bulk-select, mirroring Bills' `selected`/`toggleSelect` pattern (see
   * BillsTab.tsx) — the only two bulk actions that make sense for a
   * customer row are "remove" (reuses the same delete mutation/confirm
   * flow every row's own Trash2 button uses, just looped) and "export"
   * (reuses the same `exportToExcel` helper Bills/Expenses/Turf/Snacks
   * already call). No bulk "mark paid"-style mutation exists here since
   * customers themselves carry no payment state of their own.
   */
  const [selected, setSelected] = useState<string[]>([]);
  // Stable identity (functional update, no captured state) so memoized rows
  // don't re-render just because the parent did.
  const toggleSelect = useCallback(
    (id: string) =>
      setSelected((s) =>
        s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
      ),
    [],
  );
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  /**
   * Visit count per saved customer = bills + turf bookings + snack sales.
   * Keyed by customer id and matched phone-first (`matchesCustomer`), so two
   * different people who share a name each keep their own visits.
   */
  const visitsById = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of customers) {
      const who = { name: c.name, phone: c.phone ?? null };
      const count =
        bills.filter((b) =>
          matchesCustomer(who, b.customer_name, b.customer_phone),
        ).length +
        // A merged booking's visit is now represented by the bill it was
        // rolled into (counted above) — counting both double-counts the
        // same visit and can inflate a customer past the VIP threshold.
        // isFinancialBooking() also excludes Cancelled, which is correct
        // here too (a cancelled booking isn't a visit).
        bookings.filter(
          (b) =>
            matchesCustomer(who, b.customer_name, b.phone) &&
            isFinancialBooking(b),
        ).length +
        sales.filter(
          (s) =>
            matchesCustomer(who, s.customer_name, null) && isFinancialSale(s),
        ).length;
      map.set(c.id, count);
    }
    return map;
  }, [customers, bills, bookings, sales]);

  const tabSummaries = useTabSummaries();
  const { data: tabEntries = [] } = useTabEntries();

  /**
   * Outstanding balance per customer, straight from the one dues engine
   * (`customerOutstanding`): running tab + unpaid bookings + unpaid bills,
   * with tab-owned and merged amounts already removed at the source so no
   * rupee is counted twice.
   */
  const dueById = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of customers) {
      const phone = c.phone ?? null;
      const who = { name: c.name, phone };
      map.set(
        c.id,
        customerOutstanding(who, {
          bills,
          bookings,
          tabEntries,
          tabBalance: tabSummaries.get(tabKey(c.name, phone))?.balance ?? 0,
          match: (n, p) => matchesCustomer(who, n, p),
        }).total,
      );
    }
    return map;
  }, [customers, bills, bookings, tabEntries, tabSummaries]);

  /** Open-tab balance per customer, for the "On tab" badge in the list. */
  const tabDueById = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of customers) {
      map.set(
        c.id,
        tabSummaries.get(tabKey(c.name, c.phone ?? null))?.balance ?? 0,
      );
    }
    return map;
  }, [customers, tabSummaries]);

  const sort = useSortState<CustomerSortField>(
    "customers",
    CUSTOMER_SORT_OPTIONS,
    {
      field: "recent",
      dir: "desc",
    },
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = term
      ? customers.filter(
          (c) =>
            c.name.toLowerCase().includes(term) ||
            (c.phone ?? "").toLowerCase().includes(term),
        )
      : customers;
    if (sort.field === "recent") {
      // customers already arrives newest-first from the query; flipping dir reverses it.
      return sort.dir === "desc" ? base : [...base].reverse();
    }
    return [...base].sort((a, b) => {
      if (sort.field === "due") {
        const da = dueById.get(a.id) ?? 0;
        const db = dueById.get(b.id) ?? 0;
        return compareBy(da, db, sort.dir);
      }
      return compareBy(a.name.toLowerCase(), b.name.toLowerCase(), sort.dir);
    });
  }, [customers, q, sort.field, sort.dir, dueById]);

  const pageCount = Math.max(
    1,
    Math.ceil(filtered.length / CUSTOMER_PAGE_SIZE),
  );
  const displayedCustomers = useMemo(
    () =>
      filtered.slice(
        (page - 1) * CUSTOMER_PAGE_SIZE,
        page * CUSTOMER_PAGE_SIZE,
      ),
    [filtered, page],
  );

  // A new search or sort should start at the beginning, and a deletion should
  // never leave the user on a page that no longer exists.
  useEffect(() => {
    setPage(1);
  }, [q, sort.field, sort.dir]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const add = () => {
    if (!form.name.trim()) {
      toast.error("Customer name required");
      return;
    }
    if (form.phone && !/^\d{10}$/.test(form.phone)) {
      toast.error("Phone must be 10 digits");
      return;
    }
    save.mutate(
      { name: form.name.trim(), phone: form.phone.trim() || null },
      {
        onSuccess: (result) => {
          if (result === "duplicate") {
            toast.info("Customer already saved");
            return;
          }
          setForm({ name: "", phone: "" });
          toast.success(
            result === "updated"
              ? "Existing customer updated"
              : "Customer added",
          );
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const saveEdit = () => {
    if (!editTarget) return;
    if (!editTarget.name.trim()) {
      toast.error("Customer name required");
      return;
    }
    if (editTarget.phone && !/^\d{10}$/.test(editTarget.phone)) {
      toast.error("Phone must be 10 digits");
      return;
    }
    update.mutate(
      {
        id: editTarget.id,
        name: editTarget.name.trim(),
        phone: editTarget.phone.trim() || null,
      },
      {
        onSuccess: () => {
          setEditTarget(null);
          toast.success("Customer updated");
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const bulkDeleteCustomers = async () => {
    const ids = [...selected];
    setConfirmBulkDelete(false);
    for (const id of ids) await del.mutateAsync(id);
    setSelected([]);
    toast.success(
      `Removed ${ids.length} customer${ids.length === 1 ? "" : "s"}`,
    );
  };

  const bulkExportCustomers = () => {
    const rows = customers
      .filter((c) => selected.includes(c.id))
      .map((c) => ({
        Name: c.name,
        Phone: c.phone ?? "",
        Visits: visitsById.get(c.id) ?? 0,
        Due: dueById.get(c.id) ?? 0,
        "On tab": tabDueById.get(c.id) ?? 0,
      }));
    exportToExcel(rows, "customers-selected", "Customers");
  };

  return (
    <section className="space-y-3">
      <SectionHeading
        eyebrow="CUSTOMERS"
        title="Customer database"
        icon={Users}
        action={
          <SortMenu
            options={CUSTOMER_SORT_OPTIONS}
            field={sort.field}
            dir={sort.dir}
            onFieldChange={sort.setField}
            onToggleDir={sort.toggleDir}
          />
        }
      />
      <Card className="frost">
        <CardContent className="space-y-3 p-4">
          {isMobile && (
            <CustomerDetailDialog
              name={openCustomer?.name ?? null}
              phone={openCustomer?.phone ?? null}
              onOpenChange={(o) => !o && setOpenCustomer(null)}
            />
          )}
          <AlertDialog
            open={confirmDelete != null}
            onOpenChange={(o) => !o && setConfirmDelete(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Remove "{confirmDelete?.name}" from customers?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This only removes the saved contact entry — their bills,
                  bookings and sales history are stored separately and are not
                  affected. You can re-add them anytime.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    if (!confirmDelete) return;
                    const id = confirmDelete.id;
                    setConfirmDelete(null);
                    del.mutate(id, {
                      onSuccess: () => toast.success("Removed"),
                    });
                  }}
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog
            open={confirmBulkDelete}
            onOpenChange={(o) => !o && setConfirmBulkDelete(false)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Remove {selected.length} customer
                  {selected.length === 1 ? "" : "s"}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This only removes the saved contact entries — their bills,
                  bookings and sales history are stored separately and are not
                  affected. You can re-add them anytime.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    void bulkDeleteCustomers();
                  }}
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Dialog
            open={editTarget != null}
            onOpenChange={(o) => !o && setEditTarget(null)}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit customer</DialogTitle>
                <DialogDescription>
                  Updates the saved name/phone only — past bills, bookings and
                  sales already recorded under the old details are unchanged.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="micro-label">Name</Label>
                  <Input
                    value={editTarget?.name ?? ""}
                    onChange={(e) =>
                      setEditTarget((t) =>
                        t ? { ...t, name: e.target.value } : t,
                      )
                    }
                    placeholder="Customer name"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="micro-label">Phone</Label>
                  <Input
                    inputMode="numeric"
                    value={editTarget?.phone ?? ""}
                    onChange={(e) =>
                      setEditTarget((t) =>
                        t
                          ? { ...t, phone: e.target.value.replace(/\D/g, "") }
                          : t,
                      )
                    }
                    placeholder="10 digits"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditTarget(null)}>
                  Cancel
                </Button>
                <Button disabled={update.isPending} onClick={saveEdit}>
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or phone"
              data-shortcut="search"
            />
          </div>

          {(() => {
            const rowsList = (
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {customers.length
                      ? "No matches."
                      : "No saved customers yet."}
                  </p>
                ) : (
                  displayedCustomers.map((c) => (
                    <CustomerRow
                      key={c.id}
                      customer={c}
                      visits={visitsById.get(c.id) ?? 0}
                      due={dueById.get(c.id) ?? 0}
                      tabDue={tabDueById.get(c.id) ?? 0}
                      isActive={
                        !isMobile &&
                        openCustomer?.name === c.name &&
                        (openCustomer?.phone ?? null) === (c.phone ?? null)
                      }
                      isChecked={selected.includes(c.id)}
                      isMobile={isMobile}
                      onToggleSelect={toggleSelect}
                      onOpen={setOpenCustomer}
                      onEdit={setEditTarget}
                      onDelete={setConfirmDelete}
                    />
                  ))
                )}
              </div>
            );

            const pagination = filtered.length > CUSTOMER_PAGE_SIZE && (
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  Showing {(page - 1) * CUSTOMER_PAGE_SIZE + 1}–
                  {Math.min(page * CUSTOMER_PAGE_SIZE, filtered.length)} of{" "}
                  {filtered.length}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 1}
                    onClick={() => setPage((current) => current - 1)}
                  >
                    Previous
                  </Button>
                  <span className="px-1">
                    Page {page} of {pageCount}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === pageCount}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            );

            // Same bulk-select bar shape as Bills' (BillsTab.tsx) — count,
            // the available bulk actions, and a Clear button.
            const bulkBar = selected.length > 0 && (
              <Card className="frost border-primary/40">
                <CardContent className="flex flex-wrap items-center gap-2 pt-5">
                  <span className="text-sm font-medium">
                    {selected.length} selected
                  </span>
                  <Button
                    variant="destructive"
                    className="h-10"
                    onClick={() => setConfirmBulkDelete(true)}
                  >
                    <Trash2 className="size-4" /> Remove
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10"
                    onClick={bulkExportCustomers}
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
            );

            // Below 768px (unchanged): tapping a row opens the dialog above.
            // 768px and up (new): the list stays in a left column while the
            // selected customer's full detail renders inline in a sticky
            // right column instead — same pattern already shipped for
            // Outstanding and Bills.
            return isMobile ? (
              <ListDisclosure
                storageKey="customers.directory"
                label="Saved customers"
                count={filtered.length}
              >
                {bulkBar}
                {rowsList}
                {pagination}
              </ListDisclosure>
            ) : (
              <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start gap-4">
                <div className="min-w-0 space-y-3">
                  <p className="micro-label px-1">
                    Saved customers{" "}
                    <span className="text-muted-foreground">
                      ({filtered.length})
                    </span>
                  </p>
                  {bulkBar}
                  {rowsList}
                  {pagination}
                </div>
                <div className="sticky top-24 min-w-0">
                  {openCustomer ? (
                    <Card className="frost">
                      <CardContent className="max-h-[calc(100dvh-8rem)] overflow-y-auto pt-5">
                        <CustomerDetailContent
                          name={openCustomer.name}
                          phone={openCustomer.phone}
                        />
                      </CardContent>
                    </Card>
                  ) : (
                    <Card className="frost-well border-dashed">
                      <CardContent className="flex min-h-[16rem] flex-col items-center justify-center gap-2 pt-5 text-center text-sm text-muted-foreground">
                        <Users className="size-6 opacity-50" />
                        <p>
                          Select a customer to see their full history and
                          balance.
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="frost-well grid grid-cols-2 gap-2 rounded-xl p-3 md:grid-cols-[1.4fr_1fr_auto] md:items-end">
            <div className="space-y-1">
              <Label className="micro-label">Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Customer name"
              />
            </div>
            <div className="space-y-1">
              <Label className="micro-label">Phone</Label>
              <Input
                inputMode="numeric"
                value={form.phone}
                onChange={(e) =>
                  setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })
                }
                placeholder="10 digits"
              />
            </div>
            <Button className="col-span-2 md:col-span-1" onClick={add}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={cleanup.isPending}
              onClick={() =>
                cleanup.mutate(undefined, {
                  onSuccess: (n) =>
                    toast.success(
                      n
                        ? `Removed ${n} duplicate${n > 1 ? "s" : ""}`
                        : "No duplicates found",
                    ),
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              <Sparkles className="mr-1 h-4 w-4" /> Remove duplicates
            </Button>
            <MergeCustomersDialog customers={customers} />
          </div>

          <p className="text-xs text-muted-foreground">
            Exact duplicate names/phones are merged automatically — use "Merge
            customers" for near-duplicates (e.g. a typo or a second phone
            number) that need a manual pick. VIP tag kicks in at 5+ visits.
            Saved customers power the name/phone autofill in Turf, Snacks and
            Bills.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
