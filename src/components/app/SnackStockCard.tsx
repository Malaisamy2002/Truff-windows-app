import { useMemo, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangle,
  Boxes,
  Check,
  ClipboardList,
  History,
  Minus,
  Plus,
  Tags,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ListDisclosure } from "./ListDisclosure";
import { SectionHeading } from "@/components/app/SectionHeading";
import { LayoutPart, LayoutParts } from "./LayoutSection";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  SNACK_STOCK_REASON_LABELS,
  useAdjustSnackStock,
  useSaveStockTake,
  useSnackItems,
  useSnackStockHistory,
  type SnackItem,
  type SnackStockReason,
} from "@/lib/ops";
import { compareBy, useSortState, type SortOption } from "@/lib/sort";
import { SortMenu } from "./SortMenu";

const ALL_CATEGORIES = "__all__";

/** Reasons a person can pick when adjusting stock by hand. "sale",
 * "sale_reversal" and "stock_take" are applied automatically elsewhere
 * (checkout, bill deletion, stock-take mode) and aren't offered here. */
const ADJUST_REASONS = [
  "purchase",
  "damage",
  "expired",
  "manual_correction",
  "opening_stock",
] as const satisfies readonly SnackStockReason[];

/** Whether a reason's default action adds to stock or removes from it —
 * used to pick a sensible default when the reason changes, not to lock the
 * action (the person can still flip it). */
const REASON_DEFAULT_ACTION: Record<
  (typeof ADJUST_REASONS)[number],
  "add" | "remove" | "set"
> = {
  purchase: "add",
  damage: "remove",
  expired: "remove",
  manual_correction: "set",
  opening_stock: "set",
};

type StockSortField = "name" | "stock" | "updated";

const STOCK_SORT_OPTIONS: SortOption<StockSortField>[] = [
  { value: "stock", label: "Stock level", defaultDir: "asc" },
  { value: "name", label: "Name", defaultDir: "asc" },
  { value: "updated", label: "Recently updated", defaultDir: "desc" },
];

/** Stock counts per snack: quick +/- and an exact stock-take input, grouped
 * by category with a filter, a last-updated timestamp, and a per-item
 * change history popover. */
export function SnackStockCard() {
  const { data: items = [] } = useSnackItems();
  const adjust = useAdjustSnackStock();
  const stockTake = useSaveStockTake();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [category, setCategory] = useState(ALL_CATEGORIES);
  // Stock-take mode: every visible item becomes a single exact-count input,
  // prefilled with its current quantity, saved as one batch on "Save count".
  const [takeMode, setTakeMode] = useState(false);
  const [takeCounts, setTakeCounts] = useState<Record<string, string>>({});
  const sort = useSortState<StockSortField>("snack-stock", STOCK_SORT_OPTIONS, {
    field: "stock",
    dir: "asc",
  });

  const active = items.filter((i) => i.is_active);
  const low = active.filter((i) => i.stock_quantity <= i.low_stock_threshold);

  const categories = useMemo(
    () =>
      Array.from(new Set(active.map((i) => i.category || "General"))).sort(),
    [active],
  );

  const visible =
    category === ALL_CATEGORIES
      ? active
      : active.filter((i) => (i.category || "General") === category);

  // Grouped by category so a long "All categories" list still scans easily;
  // collapses to a single group when a specific category is selected.
  const groups = useMemo(() => {
    const map = new Map<string, SnackItem[]>();
    for (const item of visible) {
      const key = item.category || "General";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    const compareItems = (a: SnackItem, b: SnackItem) => {
      switch (sort.field) {
        case "name":
          return compareBy(
            a.item_name.toLowerCase(),
            b.item_name.toLowerCase(),
            sort.dir,
          );
        case "updated":
          return compareBy(
            a.stock_updated_at ? new Date(a.stock_updated_at).getTime() : 0,
            b.stock_updated_at ? new Date(b.stock_updated_at).getTime() : 0,
            sort.dir,
          );
        case "stock":
        default:
          return compareBy(a.stock_quantity, b.stock_quantity, sort.dir);
      }
    };
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([name, groupItems]) =>
          [name, [...groupItems].sort(compareItems)] as const,
      );
  }, [visible, sort.field, sort.dir]);

  const setStock = (
    item: SnackItem,
    next: number,
    previous: number,
    undoLabel?: string,
    reason?: SnackStockReason,
  ) => {
    setPendingId(item.id);
    adjust.mutate(
      { id: item.id, stock_quantity: next, reason },
      {
        onSuccess: () => {
          setDraft((d) => ({ ...d, [item.id]: "" }));
          if (undoLabel) {
            toast(undoLabel, {
              action: {
                label: "Undo",
                onClick: () =>
                  adjust.mutate({ id: item.id, stock_quantity: previous }),
              },
            });
          }
        },
        onError: (e) => toast.error(e.message),
        onSettled: () => setPendingId((id) => (id === item.id ? null : id)),
      },
    );
  };

  const addFromDraft = (item: SnackItem) => {
    const amount = Math.max(0, Number(draft[item.id]) || 0);
    if (!amount) return;
    setStock(item, item.stock_quantity + amount, item.stock_quantity);
  };

  const startTakeMode = () => {
    const counts: Record<string, string> = {};
    for (const item of active) counts[item.id] = String(item.stock_quantity);
    setTakeCounts(counts);
    setTakeMode(true);
  };

  const cancelTakeMode = () => {
    setTakeMode(false);
    setTakeCounts({});
  };

  const takeChanges = useMemo(
    () =>
      active
        .map((item) => ({
          item,
          next: Number(takeCounts[item.id]),
        }))
        .filter(
          ({ item, next }) =>
            takeCounts[item.id] !== undefined &&
            takeCounts[item.id] !== "" &&
            Number.isFinite(next) &&
            Math.max(0, Math.round(next)) !== item.stock_quantity,
        ),
    [active, takeCounts],
  );

  const saveTakeMode = () => {
    if (takeChanges.length === 0) {
      toast("No counts changed — nothing to save.");
      cancelTakeMode();
      return;
    }
    stockTake.mutate(
      takeChanges.map(({ item, next }) => ({
        id: item.id,
        stock_quantity: next,
      })),
      {
        onSuccess: ({ changed }) => {
          toast(
            `Stock take saved — ${changed} item${changed === 1 ? "" : "s"} updated.`,
          );
          cancelTakeMode();
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <Card>
      <CardContent className="space-y-4">
        <LayoutParts sectionId="snacks.stock" className="space-y-4">
          <LayoutPart id="snacks.stock.heading" className="space-y-4">
            <SectionHeading
              icon={Boxes}
              eyebrow="Inventory"
              title="Stock counts"
              action={
                <div className="flex flex-wrap items-center gap-2">
                  {!takeMode && (
                    <>
                      <SortMenu
                        options={STOCK_SORT_OPTIONS}
                        field={sort.field}
                        dir={sort.dir}
                        onFieldChange={sort.setField}
                        onToggleDir={sort.toggleDir}
                      />
                      {categories.length > 1 && (
                        <Select value={category} onValueChange={setCategory}>
                          <SelectTrigger className="h-8 w-40">
                            <SelectValue placeholder="Category" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ALL_CATEGORIES}>
                              All categories
                            </SelectItem>
                            {categories.map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {active.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5"
                          onClick={startTakeMode}
                        >
                          <ClipboardList className="h-3.5 w-3.5" />
                          Stock take
                        </Button>
                      )}
                    </>
                  )}
                  {takeMode && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5"
                        onClick={cancelTakeMode}
                        disabled={stockTake.isPending}
                      >
                        <X className="h-3.5 w-3.5" />
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 gap-1.5"
                        onClick={saveTakeMode}
                        disabled={stockTake.isPending}
                      >
                        <Check className="h-3.5 w-3.5" />
                        Save count
                        {takeChanges.length > 0 && ` (${takeChanges.length})`}
                      </Button>
                    </>
                  )}
                </div>
              }
            />
            {active.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Add snack items in Settings first.
              </p>
            )}

            {takeMode && (
              <div className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
                <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p>
                  Stock take in progress — enter the counted amount for each
                  item, then <span className="font-medium">Save count</span> to
                  apply every change at once. Only items whose count actually
                  changed are recorded.
                </p>
              </div>
            )}

            {!takeMode && low.length > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p>
                  Running low:{" "}
                  <span className="font-medium">
                    {low
                      .map((i) => `${i.item_name} (${i.stock_quantity})`)
                      .join(", ")}
                  </span>
                </p>
              </div>
            )}
          </LayoutPart>

          <LayoutPart id="snacks.stock.table" className="space-y-4">
            <ListDisclosure
              storageKey="snacks.stock"
              label="Stock items"
              count={active.length}
            >
              {groups.map(([groupName, groupItems]) => (
                <div key={groupName} className="space-y-2">
                  {category === ALL_CATEGORIES && categories.length > 1 && (
                    <p className="micro-label">{groupName}</p>
                  )}
                  {groupItems.map((i) => (
                    <StockRow
                      key={i.id}
                      item={i}
                      draftValue={draft[i.id] ?? ""}
                      pending={pendingId === i.id}
                      onDraftChange={(value) =>
                        setDraft((d) => ({ ...d, [i.id]: value }))
                      }
                      onAdd={() => addFromDraft(i)}
                      onIncrement={() =>
                        setStock(
                          i,
                          i.stock_quantity + 1,
                          i.stock_quantity,
                          `${i.item_name} stock increased to ${i.stock_quantity + 1}`,
                          "manual_correction",
                        )
                      }
                      onDecrement={() =>
                        setStock(
                          i,
                          i.stock_quantity - 1,
                          i.stock_quantity,
                          `${i.item_name} stock reduced to ${i.stock_quantity - 1}`,
                          "manual_correction",
                        )
                      }
                      onReasonAdjust={(next, reason) =>
                        setStock(
                          i,
                          next,
                          i.stock_quantity,
                          `${i.item_name} stock set to ${next} (${SNACK_STOCK_REASON_LABELS[reason]})`,
                          reason,
                        )
                      }
                      takeMode={takeMode}
                      takeValue={takeCounts[i.id] ?? ""}
                      onTakeChange={(value) =>
                        setTakeCounts((d) => ({ ...d, [i.id]: value }))
                      }
                    />
                  ))}
                </div>
              ))}
            </ListDisclosure>
          </LayoutPart>
        </LayoutParts>
      </CardContent>
    </Card>
  );
}

function StockRow({
  item: i,
  draftValue,
  pending,
  onDraftChange,
  onAdd,
  onIncrement,
  onDecrement,
  onReasonAdjust,
  takeMode,
  takeValue,
  onTakeChange,
}: {
  item: SnackItem;
  draftValue: string;
  pending: boolean;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  onReasonAdjust: (next: number, reason: SnackStockReason) => void;
  takeMode: boolean;
  takeValue: string;
  onTakeChange: (value: string) => void;
}) {
  if (takeMode) {
    const parsed = Number(takeValue);
    const changed =
      takeValue !== "" &&
      Number.isFinite(parsed) &&
      Math.max(0, Math.round(parsed)) !== i.stock_quantity;
    return (
      <div className="lift frost-soft flex flex-wrap items-center gap-2 rounded-xl border p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{i.item_name}</p>
          <p className="text-xs text-muted-foreground">
            was {i.stock_quantity}
          </p>
        </div>
        <Input
          className={cn("h-9 w-24", changed && "border-primary")}
          type="number"
          min={0}
          value={takeValue}
          onChange={(e) => onTakeChange(e.target.value)}
          aria-label={`Counted stock for ${i.item_name}`}
        />
      </div>
    );
  }

  return (
    <div className="lift frost-soft flex flex-wrap items-center gap-2 rounded-xl border p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{i.item_name}</p>
        <p
          className={cn(
            "text-xs text-muted-foreground",
            i.stock_quantity <= i.low_stock_threshold && "text-destructive",
          )}
        >
          {i.stock_quantity} left · alert at {i.low_stock_threshold}
          {i.stock_updated_at && (
            <>
              {" "}
              · updated{" "}
              {formatDistanceToNowStrict(new Date(i.stock_updated_at), {
                addSuffix: true,
              })}
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="outline"
          className="size-9"
          aria-label={`Reduce ${i.item_name} stock`}
          disabled={pending}
          onClick={onDecrement}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="size-9"
          aria-label={`Add one to ${i.item_name} stock`}
          disabled={pending}
          onClick={onIncrement}
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Input
          className="h-9 w-20"
          type="number"
          min={0}
          placeholder="Add"
          value={draftValue}
          disabled={pending}
          onChange={(e) => {
            const raw = e.target.value;
            // Clamp to non-negative so this box only ever adds, never subtracts.
            const clamped =
              raw === "" ? "" : String(Math.max(0, Number(raw) || 0));
            onDraftChange(clamped);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") onAdd();
          }}
        />
        <Button
          size="icon"
          variant="outline"
          className="size-9"
          aria-label={`Add entered amount to ${i.item_name} stock`}
          disabled={!draftValue || pending}
          onClick={onAdd}
        >
          <Check className="h-4 w-4" />
        </Button>
        <ReasonAdjustPopover
          item={i}
          pending={pending}
          onApply={onReasonAdjust}
        />
        <StockHistoryButton item={i} />
      </div>
    </div>
  );
}

/** Popover for a reasoned stock change (Purchase, Damage, Expired, Manual
 * correction, Opening stock) — separate from the quick +/- taps and the
 * plain "Add" box, which stay unreasoned/fast. */
function ReasonAdjustPopover({
  item,
  pending,
  onApply,
}: {
  item: SnackItem;
  pending: boolean;
  onApply: (next: number, reason: SnackStockReason) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<SnackStockReason>("purchase");
  const [action, setAction] = useState<"add" | "remove" | "set">(
    REASON_DEFAULT_ACTION.purchase,
  );
  const [qty, setQty] = useState("");

  const handleReasonChange = (value: string) => {
    const r = value as SnackStockReason;
    setReason(r);
    setAction(REASON_DEFAULT_ACTION[r as keyof typeof REASON_DEFAULT_ACTION]);
    setQty("");
  };

  const amount = Math.max(0, Number(qty) || 0);
  const next =
    action === "set"
      ? amount
      : action === "add"
        ? item.stock_quantity + amount
        : Math.max(0, item.stock_quantity - amount);
  const canApply = qty !== "" && amount >= 0 && next !== item.stock_quantity;

  const apply = () => {
    if (!canApply) return;
    onApply(next, reason);
    setOpen(false);
    setQty("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setReason("purchase");
          setAction(REASON_DEFAULT_ACTION.purchase);
          setQty("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-9"
          aria-label={`Adjust ${item.item_name} stock with a reason`}
          disabled={pending}
        >
          <Tags className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" align="end">
        <p className="text-sm font-medium">{item.item_name}</p>
        <div className="space-y-1.5">
          <label className="micro-label">Reason</label>
          <Select value={reason} onValueChange={handleReasonChange}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADJUST_REASONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {SNACK_STOCK_REASON_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1.5">
            <label className="micro-label">Action</label>
            <Select
              value={action}
              onValueChange={(v) => setAction(v as typeof action)}
            >
              <SelectTrigger className="h-8 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="add">Add</SelectItem>
                <SelectItem value="remove">Remove</SelectItem>
                <SelectItem value="set">Set to</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 space-y-1.5">
            <label className="micro-label">
              {action === "set" ? "New count" : "Quantity"}
            </label>
            <Input
              className="h-8"
              type="number"
              min={0}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply();
              }}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {qty === "" ? (
            "Enter a quantity."
          ) : next === item.stock_quantity ? (
            "No change from the current count."
          ) : (
            <>
              {item.stock_quantity} →{" "}
              <span className="font-medium">{next}</span>
            </>
          )}
        </p>
        <Button
          size="sm"
          className="w-full"
          disabled={!canApply}
          onClick={apply}
        >
          Apply
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function StockHistoryButton({ item }: { item: SnackItem }) {
  const [open, setOpen] = useState(false);
  const { data: history = [], isLoading } = useSnackStockHistory(item.id, 10);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-9"
          aria-label={`View ${item.item_name} stock history`}
        >
          <History className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <p className="mb-2 text-sm font-medium">
          {item.item_name} — recent changes
        </p>
        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!isLoading && history.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No changes recorded yet.
          </p>
        )}
        <ul className="max-h-64 space-y-1.5 overflow-y-auto text-xs">
          {history.map((h) => (
            <li
              key={h.id}
              className="flex flex-wrap items-center justify-between gap-x-2"
            >
              <span
                className={cn(
                  h.delta > 0 ? "text-success" : "text-destructive",
                )}
              >
                {h.delta > 0 ? `+${h.delta}` : h.delta}
              </span>
              <span className="text-muted-foreground">
                {h.previous_quantity} → {h.new_quantity}
              </span>
              {h.reason && (
                <span className="text-muted-foreground">
                  {SNACK_STOCK_REASON_LABELS[h.reason]}
                </span>
              )}
              <span className="w-full text-right text-muted-foreground">
                {formatDistanceToNowStrict(new Date(h.created_at), {
                  addSuffix: true,
                })}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
