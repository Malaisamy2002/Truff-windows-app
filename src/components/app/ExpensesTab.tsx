import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Download,
  Paperclip,
  Image as ImageIcon,
  Repeat,
  Power,
  Wallet,
  ReceiptText,
  PiggyBank,
  ListTree,
  X,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDMY, money, shortDate } from "@/lib/biz";
import { statsForMonth } from "@/lib/analytics";
import { exportToExcel } from "@/lib/xlsx";
import { useBills } from "@/lib/data";
import { cn, localDateStr } from "@/lib/utils";
import { isDesktop, INVOICE_SECTIONS } from "@/lib/desktop";
import {
  compareBy,
  sortSuffix,
  useSortState,
  type SortOption,
} from "@/lib/sort";
import { usePersistedState } from "@/lib/ui-prefs";
import {
  BUSINESSES,
  EXPENSE_CATEGORIES_V2,
  useAddExpenseV2,
  useDeleteExpenseV2,
  useExpensesV2,
  useSnackSales,
  useTurfBookings,
} from "@/lib/ops";
import {
  categoryIcon,
  deleteReceipt,
  missingReceiptMessage,
  monthKey,
  receiptUrl,
  uploadReceipt,
  useAddRecurringExpense,
  useBudgets,
  useDeleteRecurringExpense,
  useRecurringExpenses,
  useRunRecurringExpenses,
  useSetBudget,
  useToggleRecurringExpense,
} from "@/lib/expenses";
import { useTabEntries } from "@/lib/tabs";
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

const today = () => localDateStr();

type ExpenseSortField = "date" | "amount" | "category";

const EXPENSE_SORT_OPTIONS: SortOption<ExpenseSortField>[] = [
  { value: "date", label: "Date", defaultDir: "desc" },
  { value: "amount", label: "Amount", defaultDir: "desc" },
  { value: "category", label: "Category", defaultDir: "asc" },
];

type RecurringSortField = "name" | "amount" | "category" | "day" | "lastAdded";

const RECURRING_SORT_OPTIONS: SortOption<RecurringSortField>[] = [
  { value: "amount", label: "Amount", defaultDir: "desc" },
  { value: "name", label: "Name (A–Z)", defaultDir: "asc" },
  { value: "category", label: "Category", defaultDir: "asc" },
  { value: "day", label: "Day of month", defaultDir: "asc" },
  { value: "lastAdded", label: "Last added", defaultDir: "desc" },
];

type CategoryBreakdownSortField = "amount" | "name";

const CATEGORY_BREAKDOWN_SORT_OPTIONS: SortOption<CategoryBreakdownSortField>[] =
  [
    { value: "amount", label: "Amount", defaultDir: "desc" },
    { value: "name", label: "Name (A–Z)", defaultDir: "asc" },
  ];

export function ExpensesTab() {
  const { data: expenses = [] } = useExpensesV2();
  const { data: bills = [] } = useBills();
  const { data: bookings = [] } = useTurfBookings();
  const { data: sales = [] } = useSnackSales();
  const { data: budgets = [] } = useBudgets();
  const { data: recurring = [] } = useRecurringExpenses();
  const { data: tabEntries = [] } = useTabEntries();
  const addExpense = useAddExpenseV2();
  const deleteExpense = useDeleteExpenseV2();
  const setBudget = useSetBudget();
  const addRecurring = useAddRecurringExpense();
  const toggleRecurring = useToggleRecurringExpense();
  const deleteRecurring = useDeleteRecurringExpense();
  const runRecurring = useRunRecurringExpenses();

  /** Bulk-select for the expense list, mirroring Bills'/Customers'
   * `selected`/`toggleSelect` pattern — the only two bulk actions that make
   * sense here are delete (loops the same `useDeleteExpenseV2` mutation
   * each row's own `ConfirmDeleteButton` already calls) and export (reuses
   * the same `exportToExcel` shape `exportExpenses` below already builds,
   * scoped to just the selected rows). */
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>([]);
  const toggleSelectExpense = (id: string) =>
    setSelectedExpenseIds((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  const [confirmBulkDeleteExpenses, setConfirmBulkDeleteExpenses] =
    useState(false);

  const month = monthKey();
  const monthBudget = budgets.find((b) => b.month === month)?.amount ?? 0;
  const [budgetInput, setBudgetInput] = useState("");
  useEffect(() => {
    setBudgetInput(monthBudget ? String(monthBudget) : "");
  }, [monthBudget]);

  // Last-used category/business survive an app restart (not just carried
  // forward within one session, which the unchanged post-submit `setForm`
  // below already did) — plan item: "auto-fill the current date and
  // last-used category."
  const [lastCategory, setLastCategory] = usePersistedState(
    "expenses-last-category",
    "Raw Material",
  );
  const [lastBusiness, setLastBusiness] = usePersistedState(
    "expenses-last-business",
    "Shared",
  );
  const [form, setForm] = useState({
    spent_at: today(),
    business: lastBusiness,
    category: lastCategory,
    description: "",
    amount: "",
    note: "",
  });
  const amountRef = useRef<HTMLInputElement>(null);

  // One-tap shortcuts for expenses that repeat often (e.g. "Ice — Raw
  // Material" every few days) — plan item: "add common expense shortcuts."
  // Built from the person's own history, not a fixed list: a category +
  // description pair only becomes a shortcut once it's been logged twice,
  // so a fresh install with little history shows none rather than noise.
  const expenseShortcuts = useMemo(() => {
    const map = new Map<
      string,
      { business: string; category: string; description: string; count: number }
    >();
    for (const e of expenses) {
      const desc = e.description?.trim();
      if (!desc) continue;
      const key = `${e.category}::${desc.toLowerCase()}`;
      const cur = map.get(key);
      if (cur) cur.count += 1;
      else
        map.set(key, {
          business: e.business,
          category: e.category,
          description: desc,
          count: 1,
        });
    }
    return Array.from(map.values())
      .filter((s) => s.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [expenses]);

  const applyExpenseShortcut = (s: {
    business: string;
    category: string;
    description: string;
  }) => {
    setForm({
      ...form,
      business: s.business,
      category: s.category,
      description: s.description,
    });
    // Same "focus the next thing to fill in" pattern the Snacks quick-add
    // grid uses after a one-tap add — only the amount is left to type.
    requestAnimationFrame(() => amountRef.current?.focus());
  };
  // The photo is written straight to the database (uploadReceipt) the
  // moment it's picked, not deferred until the form is submitted — so it
  // survives even if the person never gets around to submitting. `receipt`
  // holds only display info (name) once `receiptPath` confirms it's saved;
  // `pendingReceiptPath` mirrors `receiptPath` in a ref so the unmount
  // cleanup effect below can see the latest value without depending on it.
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptPath, setReceiptPath] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const pendingReceiptPath = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    pendingReceiptPath.current = receiptPath;
  }, [receiptPath]);

  // Best-effort: if the form is abandoned (tab switched away, component
  // unmounted) while a photo is attached but never submitted, don't leave
  // it stranded in the database with nothing pointing at it.
  useEffect(() => {
    return () => {
      if (pendingReceiptPath.current)
        void deleteReceipt(pendingReceiptPath.current);
    };
  }, []);

  const handleReceiptChange = async (file: File | null) => {
    if (!file) return;
    // Replacing an already-attached photo — the old one is about to become
    // unreachable from this form, so clean it up instead of leaving an
    // orphaned row behind.
    if (receiptPath) await deleteReceipt(receiptPath);
    setUploadingReceipt(true);
    try {
      const path = await uploadReceipt(file, form.spent_at);
      setReceipt(file);
      setReceiptPath(path);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploadingReceipt(false);
    }
  };

  const clearReceipt = () => {
    if (receiptPath) void deleteReceipt(receiptPath);
    setReceipt(null);
    setReceiptPath(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const [rule, setRule] = useState({
    title: "",
    business: "Shared",
    category: "Rent",
    amount: "",
    day_of_month: "1",
  });

  // Auto-add due recurring expenses once per session.
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || recurring.length === 0) return;
    ran.current = true;
    runRecurring.mutate(recurring, {
      onSuccess: (count) => {
        if (count)
          toast.success(
            `${count} recurring expense${count > 1 ? "s" : ""} added`,
          );
      },
      onError: (e) => toast.error((e as Error).message),
    });
  }, [recurring, runRecurring]);

  // "This month" must mean this month: use the same audited period aggregate
  // the Dashboard and Reports tabs use, tab ledger included so money owed on a
  // tab isn't counted here as well.
  const monthStats = useMemo(
    () =>
      statsForMonth({ bills, bookings, sales, expenses, tabEntries }, month),
    [bills, bookings, sales, expenses, tabEntries, month],
  );

  const spent = useMemo(
    () => expenses.reduce((s, e) => s + e.amount, 0),
    [expenses],
  );
  const monthExpenses = useMemo(
    () => expenses.filter((e) => monthKey(e.spent_at) === month),
    [expenses, month],
  );
  const monthSpent = useMemo(
    () => monthExpenses.reduce((s, e) => s + e.amount, 0),
    [monthExpenses],
  );
  const categorySort = useSortState<CategoryBreakdownSortField>(
    "expenses-by-category",
    CATEGORY_BREAKDOWN_SORT_OPTIONS,
    { field: "amount", dir: "desc" },
  );
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses)
      map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    return [...map.entries()].sort(([nameA, valueA], [nameB, valueB]) =>
      categorySort.field === "name"
        ? compareBy(nameA.toLowerCase(), nameB.toLowerCase(), categorySort.dir)
        : compareBy(valueA, valueB, categorySort.dir),
    );
  }, [expenses, categorySort.field, categorySort.dir]);

  const expenseSort = useSortState<ExpenseSortField>(
    "expenses",
    EXPENSE_SORT_OPTIONS,
    {
      field: "date",
      dir: "desc",
    },
  );
  const recurringSort = useSortState<RecurringSortField>(
    "recurring-expenses",
    RECURRING_SORT_OPTIONS,
    { field: "amount", dir: "desc" },
  );
  const sortedRecurring = useMemo(
    () =>
      [...recurring].sort((a, b) => {
        switch (recurringSort.field) {
          case "name":
            return compareBy(
              a.title.toLowerCase(),
              b.title.toLowerCase(),
              recurringSort.dir,
            );
          case "category":
            return compareBy(
              a.category.toLowerCase(),
              b.category.toLowerCase(),
              recurringSort.dir,
            );
          case "day":
            return compareBy(a.day_of_month, b.day_of_month, recurringSort.dir);
          case "lastAdded":
            return compareBy(
              a.last_posted_month ?? "",
              b.last_posted_month ?? "",
              recurringSort.dir,
            );
          case "amount":
          default:
            return compareBy(a.amount, b.amount, recurringSort.dir);
        }
      }),
    [recurring, recurringSort.field, recurringSort.dir],
  );
  const sortedExpenses = useMemo(
    () =>
      [...expenses].sort((a, b) => {
        switch (expenseSort.field) {
          case "amount":
            return compareBy(a.amount, b.amount, expenseSort.dir);
          case "category":
            return compareBy(
              a.category.toLowerCase(),
              b.category.toLowerCase(),
              expenseSort.dir,
            );
          case "date":
          default:
            return compareBy(a.spent_at, b.spent_at, expenseSort.dir);
        }
      }),
    [expenses, expenseSort.field, expenseSort.dir],
  );
  /** Set by the calendar-popup on the "Date" sort control — narrows the
   * expenses list to exactly one day. */
  const [expenseDate, setExpenseDate] = useState<string | undefined>(undefined);
  const dateFilteredExpenses = useMemo(
    () =>
      expenseDate
        ? sortedExpenses.filter((e) => e.spent_at === expenseDate)
        : sortedExpenses,
    [sortedExpenses, expenseDate],
  );

  const EXPENSES_PAGE_SIZE = 25;
  const [expensePage, setExpensePage] = useState(1);
  const expensePageCount = Math.max(
    1,
    Math.ceil(dateFilteredExpenses.length / EXPENSES_PAGE_SIZE),
  );
  const safeExpensePage = Math.min(expensePage, expensePageCount);
  const pageExpenses = useMemo(
    () =>
      dateFilteredExpenses.slice(
        (safeExpensePage - 1) * EXPENSES_PAGE_SIZE,
        safeExpensePage * EXPENSES_PAGE_SIZE,
      ),
    [dateFilteredExpenses, safeExpensePage],
  );

  useEffect(() => {
    setExpensePage(1);
  }, [expenseDate, expenseSort.field, expenseSort.dir, expenses.length]);

  const budgetPct =
    monthBudget > 0 ? Math.min(100, (monthSpent / monthBudget) * 100) : 0;
  const overBudget = monthBudget > 0 && monthSpent > monthBudget;

  const submit = async () => {
    const amount = Number(form.amount) || 0;
    if (!amount) {
      toast.error("Enter an amount");
      return;
    }
    try {
      // The photo (if any) is already in the database — attached the
      // moment it was picked, via handleReceiptChange — so this just
      // points the expense row at that already-saved path.
      await addExpense.mutateAsync({
        ...form,
        amount,
        receipt_path: receiptPath,
      });
      setLastCategory(form.category);
      setLastBusiness(form.business);
      setForm({ ...form, description: "", amount: "", note: "" });
      setReceipt(null);
      setReceiptPath(null);
      if (fileRef.current) fileRef.current.value = "";
      toast.success("Expense added");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  /**
   * `expenseNo` is the expense's reference number (`expense_no`), carried
   * through purely so a missing-photo error can name *which* receipt is
   * missing — see `missingReceiptMessage` below. It's not used to look
   * anything up; `path` is still the only lookup key.
   */
  const openReceipt = async (path: string, expenseNo: string | null) => {
    if (isDesktop()) {
      // Desktop: receiptUrl() hands the file straight to the OS's default
      // photo viewer and returns null — no browser tab involved at all.
      try {
        await receiptUrl(path);
      } catch (e) {
        toast.error(missingReceiptMessage(e as Error, expenseNo));
      }
      return;
    }
    // Web: open the tab synchronously (still inside the click's user-gesture
    // window) so browsers don't treat it as a blocked popup. We fill in
    // the actual blob URL once the async IndexedDB lookup resolves.
    const win = window.open("", "_blank", "noopener");
    try {
      const url = await receiptUrl(path);
      if (win && url) {
        win.location.href = url;
      } else if (!win) {
        // Popup blocked outright (e.g. browser setting) — nothing to fall
        // back to since we don't have a tab to redirect.
        toast.error(
          "Your browser blocked the popup. Allow popups for this site to view receipts.",
        );
      }
    } catch (e) {
      win?.close();
      toast.error(missingReceiptMessage(e as Error, expenseNo));
    }
  };

  const saveBudget = async () => {
    try {
      await setBudget.mutateAsync({ month, amount: Number(budgetInput) || 0 });
      toast.success("Budget saved");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const submitRule = async () => {
    const amount = Number(rule.amount) || 0;
    if (!rule.title.trim() || !amount) {
      toast.error("Enter a name and amount");
      return;
    }
    const day = Math.min(28, Math.max(1, Number(rule.day_of_month) || 1));
    try {
      await addRecurring.mutateAsync({
        title: rule.title.trim(),
        business: rule.business,
        category: rule.category,
        amount,
        day_of_month: day,
      });
      setRule({ ...rule, title: "", amount: "" });
      toast.success("Recurring expense saved");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const exportExpenses = () =>
    exportToExcel(
      dateFilteredExpenses.map((e) => ({
        "Expense ID": e.expense_no ?? "",
        Date: e.spent_at.slice(0, 10),
        Business: e.business,
        Category: e.category,
        Description: e.description ?? "",
        Amount: e.amount,
        Notes: e.note ?? "",
        Receipt: e.receipt_path ? "Yes" : "",
      })),
      `expenses-${sortSuffix(expenseSort.field, expenseSort.dir)}`,
      "Expenses",
      INVOICE_SECTIONS.expenses,
    );

  const bulkDeleteExpenses = async () => {
    const ids = [...selectedExpenseIds];
    setConfirmBulkDeleteExpenses(false);
    for (const id of ids) await deleteExpense.mutateAsync(id);
    setSelectedExpenseIds([]);
    toast.success(
      `Deleted ${ids.length} expense${ids.length === 1 ? "" : "s"}`,
    );
  };

  const bulkExportExpenses = () =>
    exportToExcel(
      dateFilteredExpenses
        .filter((e) => selectedExpenseIds.includes(e.id))
        .map((e) => ({
          "Expense ID": e.expense_no ?? "",
          Date: e.spent_at.slice(0, 10),
          Business: e.business,
          Category: e.category,
          Description: e.description ?? "",
          Amount: e.amount,
          Notes: e.note ?? "",
          Receipt: e.receipt_path ? "Yes" : "",
        })),
      "expenses-selected",
      "Expenses",
      INVOICE_SECTIONS.expenses,
    );

  return (
    <div className="space-y-6">
      <SectionHeading eyebrow="BILLS & MONEY" title="Expenses" icon={Wallet} />

      <AlertDialog
        open={confirmBulkDeleteExpenses}
        onOpenChange={(o) => !o && setConfirmBulkDeleteExpenses(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedExpenseIds.length} expense
              {selectedExpenseIds.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected expenses and can't be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void bulkDeleteExpenses();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LayoutSections tabId="money" className="space-y-6">
        <LayoutSection id="money.month-summary">
          <section className="space-y-3">
            <SectionHeading
              eyebrow="THIS MONTH"
              title="Money in vs money out"
            />
            <LayoutParts
              sectionId="money.month-summary"
              className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3"
            >
              <LayoutPart
                id="money.month-summary.in"
                className="frost-well rounded-2xl border p-3.5 text-center"
              >
                <p className="micro-label whitespace-nowrap">Income</p>
                <p className="stat-value mt-1 text-lg text-success">
                  {money(monthStats.netRevenue)}
                </p>
              </LayoutPart>
              <LayoutPart
                id="money.month-summary.out"
                className="frost-well rounded-2xl border p-3.5 text-center"
              >
                <p className="micro-label whitespace-nowrap">Expenses</p>
                <p className="stat-value mt-1 text-lg text-destructive">
                  {money(monthStats.expenses)}
                </p>
              </LayoutPart>
              <LayoutPart
                id="money.month-summary.net"
                className="frost-well rounded-2xl border border-primary/30 p-3.5 text-center"
              >
                <p className="micro-label whitespace-nowrap">Net profit</p>
                <p className="stat-value mt-1 text-lg text-primary">
                  {money(monthStats.profit)}
                </p>
              </LayoutPart>
            </LayoutParts>
          </section>
        </LayoutSection>

        <LayoutSection id="money.budget">
          <section className="space-y-3">
            <SectionHeading
              eyebrow="BUDGET"
              title="Monthly budget"
              icon={PiggyBank}
            />
            <Card className="frost">
              <CardContent className="space-y-3 pt-5">
                <LayoutParts sectionId="money.budget" className="space-y-3">
                  <LayoutPart id="money.budget.amount">
                    <div className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">Budget for {month}</Label>
                        <Input
                          inputMode="decimal"
                          value={budgetInput}
                          onChange={(e) => setBudgetInput(e.target.value)}
                          placeholder="0"
                        />
                      </div>
                      <Button
                        variant="outline"
                        onClick={saveBudget}
                        disabled={setBudget.isPending}
                      >
                        Save
                      </Button>
                    </div>
                  </LayoutPart>
                  <LayoutPart id="money.budget.progress" className="space-y-3">
                    <Progress value={budgetPct} />
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">
                        Spent {money(monthSpent)} of {money(monthBudget)}
                      </span>
                      <span
                        className={
                          overBudget
                            ? "font-semibold text-destructive"
                            : "text-muted-foreground"
                        }
                      >
                        {overBudget
                          ? `Over by ${money(monthSpent - monthBudget)}`
                          : monthBudget > 0
                            ? `${money(monthBudget - monthSpent)} left`
                            : "No budget set"}
                      </span>
                    </div>
                  </LayoutPart>
                </LayoutParts>
              </CardContent>
            </Card>
          </section>
        </LayoutSection>

        <LayoutSection id="money.add-expense">
          <section className="space-y-3">
            <SectionHeading eyebrow="LOG" title="Add expense" icon={Plus} />
            <Card className="frost">
              <CardContent className="pt-5">
                <LayoutParts
                  sectionId="money.add-expense"
                  className="grid gap-3 md:grid-cols-3"
                >
                  {expenseShortcuts.length > 0 && (
                    <LayoutPart
                      id="money.add-expense.shortcuts"
                      className="space-y-1 md:col-span-3"
                    >
                      <Label className="text-xs">Quick add</Label>
                      <div className="flex flex-wrap gap-2">
                        {expenseShortcuts.map((s) => (
                          <Button
                            key={`${s.category}::${s.description}`}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="lift"
                            onClick={() => applyExpenseShortcut(s)}
                          >
                            {s.description}
                          </Button>
                        ))}
                      </div>
                    </LayoutPart>
                  )}
                  <LayoutPart id="money.add-expense.date" className="space-y-1">
                    <Label className="text-xs">Date</Label>
                    <Input
                      type="date"
                      value={form.spent_at}
                      onChange={(e) =>
                        setForm({ ...form, spent_at: e.target.value })
                      }
                    />
                  </LayoutPart>
                  <LayoutPart
                    id="money.add-expense.business"
                    className="space-y-1"
                  >
                    <Label className="text-xs">Business</Label>
                    <Select
                      value={form.business}
                      onValueChange={(v) => setForm({ ...form, business: v })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BUSINESSES.map((b) => (
                          <SelectItem key={b} value={b}>
                            {b}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </LayoutPart>
                  <LayoutPart
                    id="money.add-expense.category"
                    className="space-y-1"
                  >
                    <Label className="text-xs">Category</Label>
                    <Select
                      value={form.category}
                      onValueChange={(v) => setForm({ ...form, category: v })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPENSE_CATEGORIES_V2.map((c) => {
                          const Icon = categoryIcon(c);
                          return (
                            <SelectItem key={c} value={c}>
                              <span className="flex items-center gap-2">
                                <Icon className="size-4" />
                                {c}
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </LayoutPart>
                  <LayoutPart
                    id="money.add-expense.description"
                    className="space-y-1 md:col-span-2"
                  >
                    <Label className="text-xs">Description</Label>
                    <Input
                      value={form.description}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                      }
                      placeholder="What was it for?"
                    />
                  </LayoutPart>
                  <LayoutPart
                    id="money.add-expense.amount"
                    className="space-y-1"
                  >
                    <Label className="text-xs">Amount</Label>
                    <Input
                      ref={amountRef}
                      inputMode="decimal"
                      value={form.amount}
                      onChange={(e) =>
                        setForm({ ...form, amount: e.target.value })
                      }
                      placeholder="0"
                    />
                  </LayoutPart>
                  <LayoutPart
                    id="money.add-expense.notes"
                    className="space-y-1 md:col-span-2"
                  >
                    <Label className="text-xs">Notes</Label>
                    <Input
                      value={form.note}
                      onChange={(e) =>
                        setForm({ ...form, note: e.target.value })
                      }
                      placeholder="Optional"
                    />
                  </LayoutPart>
                  <LayoutPart
                    id="money.add-expense.receipt"
                    className="space-y-1"
                  >
                    <Label className="text-xs">Receipt photo</Label>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) =>
                        void handleReceiptChange(e.target.files?.[0] ?? null)
                      }
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="lift w-full"
                        disabled={uploadingReceipt}
                        onClick={() => fileRef.current?.click()}
                      >
                        <Paperclip className="mr-1 size-4" />
                        {uploadingReceipt
                          ? "Saving…"
                          : receipt
                            ? receipt.name.slice(0, 18)
                            : "Attach photo"}
                      </Button>
                      {receiptPath && !uploadingReceipt && (
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="Remove attached photo"
                          onClick={clearReceipt}
                        >
                          <X className="size-4" />
                        </Button>
                      )}
                    </div>
                  </LayoutPart>
                  <LayoutPart id="money.add-expense.save">
                    <Button
                      className="lift w-full"
                      onClick={submit}
                      disabled={addExpense.isPending}
                      data-shortcut="save"
                    >
                      <Plus className="mr-1 size-4" /> Add expense
                    </Button>
                  </LayoutPart>
                </LayoutParts>
              </CardContent>
            </Card>
          </section>
        </LayoutSection>

        <LayoutSection id="money.recurring">
          <section className="space-y-3">
            <LayoutParts sectionId="money.recurring" className="space-y-3">
              <LayoutPart id="money.recurring.heading">
                <SectionHeading
                  eyebrow="AUTOMATION"
                  title="Recurring expenses"
                  icon={Repeat}
                  action={
                    recurring.length > 0 ? (
                      <SortMenu
                        options={RECURRING_SORT_OPTIONS}
                        field={recurringSort.field}
                        dir={recurringSort.dir}
                        onFieldChange={recurringSort.setField}
                        onToggleDir={recurringSort.toggleDir}
                      />
                    ) : undefined
                  }
                />
              </LayoutPart>
              <LayoutPart id="money.recurring.form">
                <Card className="frost">
                  <CardContent className="space-y-4 pt-5">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-1 md:col-span-2">
                        <Label className="text-xs">Name</Label>
                        <Input
                          value={rule.title}
                          onChange={(e) =>
                            setRule({ ...rule, title: e.target.value })
                          }
                          placeholder="Shop rent / Staff salary"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Amount</Label>
                        <Input
                          inputMode="decimal"
                          value={rule.amount}
                          onChange={(e) =>
                            setRule({ ...rule, amount: e.target.value })
                          }
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Category</Label>
                        <Select
                          value={rule.category}
                          onValueChange={(v) =>
                            setRule({ ...rule, category: v })
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {EXPENSE_CATEGORIES_V2.map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Business</Label>
                        <Select
                          value={rule.business}
                          onValueChange={(v) =>
                            setRule({ ...rule, business: v })
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {BUSINESSES.map((b) => (
                              <SelectItem key={b} value={b}>
                                {b}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Day of month</Label>
                        <Input
                          inputMode="numeric"
                          value={rule.day_of_month}
                          onChange={(e) =>
                            setRule({ ...rule, day_of_month: e.target.value })
                          }
                        />
                      </div>
                      <Button
                        className="lift"
                        onClick={submitRule}
                        disabled={addRecurring.isPending}
                      >
                        <Plus className="mr-1 size-4" /> Save recurring
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </LayoutPart>
              <LayoutPart id="money.recurring.list">
                <ListDisclosure
                  storageKey="money.recurring"
                  label="Recurring expenses"
                  count={recurring.length}
                >
                  <Card className="frost">
                    <CardContent className="space-y-4 pt-5">
                      {recurring.length === 0 ? (
                        <p className="py-2 text-center text-sm text-muted-foreground">
                          Nothing recurring yet. Rent and salaries get added
                          automatically each month.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {sortedRecurring.map((r) => {
                            const Icon = categoryIcon(r.category);
                            return (
                              <li
                                key={r.id}
                                className="frost-soft lift flex items-center justify-between gap-2 rounded-xl border p-3"
                              >
                                <div className="flex min-w-0 items-center gap-3">
                                  <span className="frost-well grid size-9 shrink-0 place-items-center rounded-xl border">
                                    <Icon className="size-4 text-primary" />
                                  </span>
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">
                                      {r.title}
                                      {!r.is_active && (
                                        <span className="ml-2 text-xs text-muted-foreground">
                                          (paused)
                                        </span>
                                      )}
                                    </p>
                                    <p className="truncate text-xs text-muted-foreground">
                                      {r.category} · day {r.day_of_month} ·{" "}
                                      {r.last_posted_month
                                        ? `last added ${r.last_posted_month}`
                                        : "not added yet"}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <span className="stat-value text-sm">
                                    {money(r.amount)}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-10"
                                    aria-label={
                                      r.is_active ? "Pause" : "Resume"
                                    }
                                    onClick={() =>
                                      toggleRecurring.mutate({
                                        id: r.id,
                                        is_active: !r.is_active,
                                      })
                                    }
                                  >
                                    <Power
                                      className={
                                        r.is_active
                                          ? "size-4 text-success"
                                          : "size-4"
                                      }
                                    />
                                  </Button>
                                  <ConfirmDeleteButton
                                    size="icon"
                                    className="size-10 text-destructive"
                                    ariaLabel="Delete recurring expense"
                                    title={`Delete "${r.title}"?`}
                                    description="This stops the recurring expense from being added each month. Past entries it already created are not removed."
                                    onConfirm={() =>
                                      deleteRecurring.mutate(r.id)
                                    }
                                  />
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </ListDisclosure>
              </LayoutPart>
            </LayoutParts>
          </section>
        </LayoutSection>

        <LayoutSection id="money.by-category">
          {byCategory.length > 0 && (
            <section className="space-y-3">
              <LayoutParts sectionId="money.by-category" className="space-y-3">
                <LayoutPart id="money.by-category.heading">
                  <SectionHeading
                    eyebrow="BREAKDOWN"
                    title="By category"
                    icon={ListTree}
                    action={
                      <SortMenu
                        options={CATEGORY_BREAKDOWN_SORT_OPTIONS}
                        field={categorySort.field}
                        dir={categorySort.dir}
                        onFieldChange={categorySort.setField}
                        onToggleDir={categorySort.toggleDir}
                      />
                    }
                  />
                </LayoutPart>
                <LayoutPart id="money.by-category.chart">
                  <Card className="frost">
                    <CardContent className="pt-5">
                      <ul className="space-y-3 text-sm">
                        {byCategory.map(([c, v]) => {
                          const Icon = categoryIcon(c);
                          const pct = spent > 0 ? (v / spent) * 100 : 0;
                          return (
                            <li key={c} className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-2 text-muted-foreground">
                                  <Icon className="size-4" />
                                  {c}
                                </span>
                                <span className="stat-value text-sm">
                                  {money(v)}{" "}
                                  <span className="text-xs font-normal text-muted-foreground">
                                    ({Math.round(pct)}%)
                                  </span>
                                </span>
                              </div>
                              <Progress value={pct} className="h-1.5" />
                            </li>
                          );
                        })}
                      </ul>
                    </CardContent>
                  </Card>
                </LayoutPart>
              </LayoutParts>
            </section>
          )}
        </LayoutSection>

        <LayoutSection id="money.recent">
          <section className="space-y-3">
            <LayoutParts sectionId="money.recent" className="space-y-3">
              <LayoutPart id="money.recent.toolbar">
                <SectionHeading
                  eyebrow="LEDGER"
                  title="Recent expenses"
                  icon={ReceiptText}
                  action={
                    <div className="flex items-center gap-2">
                      <SortMenu
                        options={EXPENSE_SORT_OPTIONS}
                        field={expenseSort.field}
                        dir={expenseSort.dir}
                        onFieldChange={expenseSort.setField}
                        onToggleDir={expenseSort.toggleDir}
                        dateField="date"
                        selectedDate={expenseDate}
                        onSelectDate={setExpenseDate}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={exportExpenses}
                        disabled={expenses.length === 0}
                      >
                        <Download className="mr-1 size-4" /> Excel
                      </Button>
                    </div>
                  }
                />
              </LayoutPart>
              <LayoutPart id="money.recent.list">
                <ListDisclosure
                  storageKey="money.recent"
                  label="Recent expenses"
                  count={dateFilteredExpenses.length}
                >
                  <Card className="frost">
                    <CardContent className="pt-5">
                      {expenseDate && (
                        <div className="frost-soft mb-3 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm">
                          <span>
                            Showing{" "}
                            <span className="font-medium">
                              {dateFilteredExpenses.length}
                            </span>{" "}
                            expense
                            {dateFilteredExpenses.length === 1
                              ? ""
                              : "s"} for{" "}
                            <span className="font-medium">
                              {formatDMY(expenseDate)}
                            </span>
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setExpenseDate(undefined)}
                          >
                            Clear
                          </Button>
                        </div>
                      )}
                      {expenses.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                          No expenses logged.
                        </p>
                      ) : (
                        <>
                          {selectedExpenseIds.length > 0 && (
                            <div className="frost-well mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 p-3">
                              <span className="text-sm font-medium">
                                {selectedExpenseIds.length} selected
                              </span>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() =>
                                  setConfirmBulkDeleteExpenses(true)
                                }
                              >
                                <Trash2 className="mr-1 size-4" /> Delete
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={bulkExportExpenses}
                              >
                                <Download className="mr-1 size-4" /> Export
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedExpenseIds([])}
                              >
                                Clear
                              </Button>
                            </div>
                          )}
                          <ul className="space-y-2">
                            {pageExpenses.map((e) => {
                              const Icon = categoryIcon(e.category);
                              return (
                                <li
                                  key={e.id}
                                  className="frost-soft lift flex items-center justify-between gap-2 rounded-xl border p-3"
                                >
                                  <div className="flex min-w-0 items-center gap-3">
                                    <Checkbox
                                      aria-label="Select expense"
                                      checked={selectedExpenseIds.includes(
                                        e.id,
                                      )}
                                      onCheckedChange={() =>
                                        toggleSelectExpense(e.id)
                                      }
                                    />
                                    <span className="frost-well grid size-9 shrink-0 place-items-center rounded-xl border">
                                      <Icon className="size-4 text-primary" />
                                    </span>
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-medium">
                                        {e.expense_no
                                          ? `${e.expense_no} · `
                                          : ""}
                                        {e.category}
                                        <span className="font-normal text-muted-foreground">
                                          {" "}
                                          · {e.business}
                                        </span>
                                      </p>
                                      <p className="truncate text-xs text-muted-foreground">
                                        {e.description || e.note || "—"} ·{" "}
                                        {shortDate(e.spent_at)}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1">
                                    <span className="stat-value text-sm">
                                      {money(e.amount)}
                                    </span>
                                    {e.receipt_path && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-10"
                                        aria-label="View receipt"
                                        onClick={() =>
                                          openReceipt(
                                            e.receipt_path!,
                                            e.expense_no,
                                          )
                                        }
                                      >
                                        <ImageIcon className="size-4" />
                                      </Button>
                                    )}
                                    <ConfirmDeleteButton
                                      size="icon"
                                      className="size-10 text-destructive"
                                      ariaLabel="Delete expense"
                                      title={`Delete this ${e.category.toLowerCase()} expense?`}
                                      description={`This permanently removes the ${money(e.amount)} expense from ${shortDate(e.spent_at)} and can't be undone.`}
                                      onConfirm={() =>
                                        deleteExpense.mutate(e.id)
                                      }
                                    />
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                          {dateFilteredExpenses.length > EXPENSES_PAGE_SIZE && (
                            <div className="flex items-center justify-between gap-2 pt-3">
                              <Button
                                variant="outline"
                                className="h-12"
                                disabled={safeExpensePage <= 1}
                                onClick={() =>
                                  setExpensePage(safeExpensePage - 1)
                                }
                              >
                                <ChevronLeft className="size-4" /> Prev
                              </Button>
                              <p className="text-sm text-muted-foreground">
                                Page {safeExpensePage} of {expensePageCount} ·{" "}
                                {dateFilteredExpenses.length} expenses
                              </p>
                              <Button
                                variant="outline"
                                className="h-12"
                                disabled={safeExpensePage >= expensePageCount}
                                onClick={() =>
                                  setExpensePage(safeExpensePage + 1)
                                }
                              >
                                Next <ChevronRight className="size-4" />
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                </ListDisclosure>
              </LayoutPart>
            </LayoutParts>
          </section>
        </LayoutSection>
      </LayoutSections>
    </div>
  );
}
