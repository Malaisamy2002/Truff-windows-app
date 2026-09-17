import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Plus,
  Save,
  SlidersHorizontal,
  Trash2,
  Palette,
  Image as ImageIcon,
  Receipt as ReceiptIcon,
  MessageCircle,
  CalendarClock,
  Trophy,
  Cookie,
  Layers,
  Printer,
  Archive as ArchiveIcon,
  Download as DownloadIcon,
  Send as SendIcon,
  LayoutDashboard,
  AlertTriangle,
  FlaskConical,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion } from "@/components/ui/accordion";
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
import { money } from "@/lib/biz";
import {
  useDeleteSnackItem,
  useDeleteSnackCombo,
  useDeleteTurfRate,
  useSaveSnackItem,
  useSaveSnackCombo,
  useSaveTurfRate,
  useSnackCombos,
  useSnackItems,
  useTurfRates,
  useSlotDurations,
  useSaveSlotDurations,
  DEFAULT_SLOT_DURATIONS,
  MAX_COURTS,
  clampCourts,
  type SlotDurations,
  type SnackCombo,
  type SnackItem,
  type TurfRate,
} from "@/lib/ops";
import { compareBy, useSortState, type SortOption } from "@/lib/sort";
import { usePersistedState } from "@/lib/ui-prefs";
import { SectionHeading } from "./SectionHeading";
import { FirstRunChecklistCard } from "./FirstRunChecklistCard";
import { SettingsSection } from "./SettingsSection";
import { LayoutSection, LayoutSections } from "./LayoutSection";
import { LayoutSettingsCard } from "./LayoutSettingsCard";
import { SortMenu } from "./SortMenu";
import { PrintSettingsCard } from "./PrintSettingsCard";
import { InvoiceBrandingCard } from "./InvoiceBrandingCard";
import { BackupCard } from "./BackupCard";
import { TelegramBackupCard } from "./TelegramBackupCard";
import { MonthlyReportCard } from "./MonthlyReportCard";
import { ArchiveCard } from "./ArchiveCard";
import { ClearAllDataCard } from "./ClearAllDataCard";
import { LoadTestCard } from "./LoadTestCard";
import { ThemeCustomizerCard } from "./ThemeCustomizerCard";
import { BillingSettingsCard } from "./BillingSettingsCard";
import { WhatsAppSummaryCard } from "./WhatsAppSummaryCard";

/** Trash-icon button that confirms before deleting — same settings-config items are
 * otherwise removed with a single tap and no way back. */
function ConfirmDeleteButton({
  title,
  description,
  onConfirm,
}: {
  title: string;
  description: string;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Trash2 className="h-4 w-4" />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setOpen(false);
                onConfirm();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TurfRateRow({ rate }: { rate: TurfRate }) {
  const [name, setName] = useState(rate.slot_name);
  const [amount, setAmount] = useState(String(rate.rate_per_hour));
  const [r15, setR15] = useState(
    rate.rate_15 != null ? String(rate.rate_15) : "",
  );
  const [r30, setR30] = useState(
    rate.rate_30 != null ? String(rate.rate_30) : "",
  );
  const [r45, setR45] = useState(
    rate.rate_45 != null ? String(rate.rate_45) : "",
  );
  const [r60, setR60] = useState(
    rate.rate_60 != null ? String(rate.rate_60) : "",
  );
  const save = useSaveTurfRate();
  const del = useDeleteTurfRate();

  const payload = (): TurfRate => ({
    ...rate,
    slot_name: name.trim(),
    rate_per_hour: Number(amount) || 0,
    rate_15: r15 === "" ? null : Number(r15) || 0,
    rate_30: r30 === "" ? null : Number(r30) || 0,
    rate_45: r45 === "" ? null : Number(r45) || 0,
    rate_60: r60 === "" ? null : Number(r60) || 0,
  });

  const auto = (frac: number) => Math.round(((Number(amount) || 0) * frac) / 4);

  return (
    <div className="frost-soft lift space-y-2 rounded-xl border p-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-[1fr_140px_auto_auto] md:items-center">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Slot name"
        />
        <Input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Rate / hr"
        />
        <div className="flex items-center gap-2 text-sm">
          <Switch
            checked={rate.is_active}
            onCheckedChange={(v) => save.mutate({ ...payload(), is_active: v })}
          />
          <span className="text-muted-foreground">
            {rate.is_active ? "Active" : "Off"}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              if (!name.trim()) {
                toast.error("Slot name required");
                return;
              }
              save.mutate(payload(), {
                onSuccess: () => toast.success("Rate saved"),
              });
            }}
          >
            <Save className="h-4 w-4" />
          </Button>
          <ConfirmDeleteButton
            title={`Remove "${rate.slot_name}" slot?`}
            description="This removes the rate from the list used when creating new bookings. Existing bookings already made at this rate keep their own stored price and are not affected."
            onConfirm={() =>
              del.mutate(rate.id, {
                onSuccess: () => toast.success("Slot removed"),
              })
            }
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {(
          [
            ["15 min", r15, setR15, auto(1)],
            ["30 min", r30, setR30, auto(2)],
            ["45 min", r45, setR45, auto(3)],
            ["1 hr", r60, setR60, auto(4)],
          ] as const
        ).map(([label, val, setVal, placeholder]) => (
          <div key={label} className="space-y-1">
            <Label className="micro-label">{label} price</Label>
            <Input
              inputMode="decimal"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              placeholder={`auto ${placeholder}`}
            />
          </div>
        ))}
      </div>
      <p className="micro-label text-muted-foreground">
        Leave a duration empty to auto-calculate it from the hourly rate.
      </p>
    </div>
  );
}

/** Global on/off switches for which slot durations can be picked on new turf
 * bookings — one set of toggles that applies to every rate/slot. */
function SlotDurationsCard() {
  const { data: durations = DEFAULT_SLOT_DURATIONS } = useSlotDurations();
  const save = useSaveSlotDurations();

  const toggle = (key: keyof SlotDurations, v: boolean) => {
    if (!v) {
      const others = (
        ["allow_15", "allow_30", "allow_45", "allow_60"] as const
      ).filter((k) => k !== key);
      if (!others.some((k) => durations[k])) {
        toast.error("Keep at least one slot duration on");
        return;
      }
    }
    save.mutate({ ...durations, [key]: v });
  };

  return (
    <Card className="frost">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm">
          Slot durations for new bookings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {(
            [
              ["15 min", "allow_15"],
              ["30 min", "allow_30"],
              ["45 min", "allow_45"],
              ["1 hr", "allow_60"],
            ] as const
          ).map(([label, key]) => (
            <div
              key={key}
              className="frost-soft flex items-center justify-between gap-2 rounded-xl border p-3"
            >
              <Label className="text-sm">{label}</Label>
              <Switch
                checked={durations[key]}
                aria-label={`${label} slots available`}
                onCheckedChange={(v) => toggle(key, v)}
              />
            </div>
          ))}
        </div>
        <p className="micro-label text-muted-foreground">
          Switch a duration off to hide it from the New Turf Booking form for
          every slot.
        </p>
        <div className="frost-soft flex items-center justify-between gap-3 rounded-xl border p-3">
          <div>
            <Label className="text-sm">Courts available</Label>
            <p className="micro-label text-muted-foreground">
              A time slot only shows as booked once every court is taken.
            </p>
          </div>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_COURTS}
            className="w-20 text-center"
            aria-label="Courts available"
            value={durations.total_courts ?? 1}
            onChange={(e) =>
              save.mutate({
                ...durations,
                total_courts: clampCourts(e.target.value),
              })
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SnackItemRow({ item }: { item: SnackItem }) {
  const [f, setF] = useState({
    item_name: item.item_name,
    category: item.category,
    unit_price: String(item.unit_price),
    cost_price: String(item.cost_price),
  });
  const save = useSaveSnackItem();
  const del = useDeleteSnackItem();

  return (
    <div className="frost-soft lift grid grid-cols-2 gap-2 rounded-xl border p-3 md:grid-cols-[1.4fr_1fr_110px_110px_auto_auto] md:items-center">
      <Input
        value={f.item_name}
        onChange={(e) => setF({ ...f, item_name: e.target.value })}
        placeholder="Item"
      />
      <Input
        value={f.category}
        onChange={(e) => setF({ ...f, category: e.target.value })}
        placeholder="Category"
      />
      <Input
        inputMode="decimal"
        value={f.unit_price}
        onChange={(e) => setF({ ...f, unit_price: e.target.value })}
        placeholder="Sell ₹"
      />
      <Input
        inputMode="decimal"
        value={f.cost_price}
        onChange={(e) => setF({ ...f, cost_price: e.target.value })}
        placeholder="Cost ₹"
      />
      <div className="flex items-center gap-2 text-sm">
        <Switch
          checked={item.is_active}
          onCheckedChange={(v) =>
            save.mutate({
              ...item,
              ...f,
              unit_price: Number(f.unit_price) || 0,
              cost_price: Number(f.cost_price) || 0,
              is_active: v,
            })
          }
        />
        <span className="text-muted-foreground">
          {item.is_active ? "Active" : "Off"}
        </span>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => {
            if (!f.item_name.trim()) {
              toast.error("Item name required");
              return;
            }
            save.mutate(
              {
                ...item,
                ...f,
                item_name: f.item_name.trim(),
                unit_price: Number(f.unit_price) || 0,
                cost_price: Number(f.cost_price) || 0,
              },
              { onSuccess: () => toast.success("Item saved") },
            );
          }}
        >
          <Save className="h-4 w-4" />
        </Button>
        <ConfirmDeleteButton
          title={`Remove "${item.item_name}" from the menu?`}
          description="This removes the item from the snack menu used for new sales. Past sales that included this item keep their own recorded name, price and cost, and are not affected."
          onConfirm={() =>
            del.mutate(item.id, {
              onSuccess: () => toast.success("Item removed"),
            })
          }
        />
      </div>
    </div>
  );
}

/** Editable list of {item_name, qty} lines used by both the combo row and the "new combo" form. */
function ComboItemsEditor({
  items,
  onChange,
  snackItems,
}: {
  items: SnackCombo["items"];
  onChange: (items: SnackCombo["items"]) => void;
  snackItems: SnackItem[];
}) {
  const [pick, setPick] = useState("");
  const [qty, setQty] = useState("1");

  const addItem = () => {
    if (!pick) {
      toast.error("Pick an item to add");
      return;
    }
    // Combo lines represent a count of sellable items. Accepting 0, a
    // negative number, or a fraction here creates invalid combo contents and
    // can make the sale total negative, so normalise every entry to one or
    // more whole items.
    const q = Math.max(1, Math.floor(Number(qty) || 1));
    const existing = items.find((i) => i.item_name === pick);
    if (existing) {
      onChange(
        items.map((i) => (i.item_name === pick ? { ...i, qty: i.qty + q } : i)),
      );
    } else {
      onChange([...items, { item_name: pick, qty: q }]);
    }
    setPick("");
    setQty("1");
  };

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((i) => (
            <span
              key={i.item_name}
              className="frost-soft flex items-center gap-1 rounded-full border px-2 py-1 text-xs"
            >
              {i.item_name} × {i.qty}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() =>
                  onChange(items.filter((x) => x.item_name !== i.item_name))
                }
                aria-label={`Remove ${i.item_name}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[160px] flex-1 space-y-1">
          <Label className="micro-label">Add item</Label>
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger>
              <SelectValue placeholder="Select item" />
            </SelectTrigger>
            <SelectContent>
              {snackItems.map((s) => (
                <SelectItem key={s.id} value={s.item_name}>
                  {s.item_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-20 space-y-1">
          <Label className="micro-label">Qty</Label>
          <Input
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          aria-label="Add item to combo"
          onClick={addItem}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ComboRow({
  combo,
  snackItems,
}: {
  combo: SnackCombo;
  snackItems: SnackItem[];
}) {
  const [name, setName] = useState(combo.name);
  const [price, setPrice] = useState(String(combo.price));
  const [items, setItems] = useState<SnackCombo["items"]>(combo.items);
  const save = useSaveSnackCombo();
  const del = useDeleteSnackCombo();

  const saveDraft = (is_active = combo.is_active) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Combo name required");
      return;
    }
    if (items.length === 0) {
      toast.error("Add at least one item");
      return;
    }
    save.mutate(
      {
        ...combo,
        name: trimmedName,
        price: Math.max(0, Number(price) || 0),
        items,
        is_active,
      },
      {
        onSuccess: () =>
          toast.success(
            is_active === combo.is_active ? "Combo saved" : "Combo updated",
          ),
      },
    );
  };

  return (
    <div className="frost-soft lift space-y-3 rounded-xl border p-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-[1.4fr_140px_auto_auto] md:items-center">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Combo name"
        />
        <Input
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Combo price ₹"
        />
        <div className="flex items-center gap-2 text-sm">
          <Switch checked={combo.is_active} onCheckedChange={saveDraft} />
          <span className="text-muted-foreground">
            {combo.is_active ? "Active" : "Off"}
          </span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => saveDraft()}>
            <Save className="h-4 w-4" />
          </Button>
          <ConfirmDeleteButton
            title={`Remove "${combo.name}" combo?`}
            description="This removes the combo from the list used for new sales. Past sales made with this combo keep their own recorded line items and are not affected."
            onConfirm={() =>
              del.mutate(combo.id, {
                onSuccess: () => toast.success("Combo removed"),
              })
            }
          />
        </div>
      </div>
      <ComboItemsEditor
        items={items}
        onChange={setItems}
        snackItems={snackItems}
      />
    </div>
  );
}

type TurfRateSortField = "name" | "rate" | "active";

const TURF_RATE_SORT_OPTIONS: SortOption<TurfRateSortField>[] = [
  { value: "name", label: "Name (A–Z)", defaultDir: "asc" },
  { value: "rate", label: "Rate / hr", defaultDir: "desc" },
  { value: "active", label: "Active first", defaultDir: "desc" },
];

type SnackItemSortField =
  "name" | "category" | "sell" | "cost" | "active" | "updated";

const SNACK_ITEM_SORT_OPTIONS: SortOption<SnackItemSortField>[] = [
  { value: "name", label: "Name (A–Z)", defaultDir: "asc" },
  { value: "category", label: "Category", defaultDir: "asc" },
  { value: "sell", label: "Sell price", defaultDir: "desc" },
  { value: "cost", label: "Cost price", defaultDir: "desc" },
  { value: "active", label: "Active first", defaultDir: "desc" },
  { value: "updated", label: "Recently updated", defaultDir: "desc" },
];

type SnackComboSortField = "name" | "price" | "active";

const SNACK_COMBO_SORT_OPTIONS: SortOption<SnackComboSortField>[] = [
  { value: "name", label: "Name (A–Z)", defaultDir: "asc" },
  { value: "price", label: "Price", defaultDir: "desc" },
  { value: "active", label: "Active first", defaultDir: "desc" },
];

/** true/false compared as 1/0 so "Active first" reads naturally in either direction. */
function compareActiveFirst(a: boolean, b: boolean, dir: "asc" | "desc") {
  return compareBy(a ? 1 : 0, b ? 1 : 0, dir);
}

/** Search text each settings card matches against, beyond its visible title. */
const SETTINGS_SEARCH_INDEX: { id: string; text: string }[] = [
  {
    id: "settings.billing",
    text: "billing tax gst business name invoice numbering",
  },
  { id: "settings.invoice-branding", text: "invoice branding logo receipt" },
  { id: "settings.whatsapp", text: "whatsapp summary phone sharing" },
  {
    id: "settings.turf-rates",
    text: "turf rates courts slot durations pricing hourly",
  },
  { id: "settings.snack-items", text: "snack items menu stock price cost" },
  { id: "settings.snack-combos", text: "snack combos menu bundle" },
  { id: "settings.print", text: "printer receipt format print" },
  { id: "settings.telegram", text: "telegram cloud backup data safety" },
  { id: "settings.backup", text: "backup restore export data safety" },
  { id: "settings.archive", text: "year archive data lifecycle" },
  { id: "settings.theme", text: "theme appearance look feel colors" },
  {
    id: "settings.layout",
    text: "layout arrangement reorder hide tabs blocks density",
  },
  { id: "settings.monthly-report", text: "monthly report reminders" },
  {
    id: "settings.loadtest",
    text: "load test diagnostics demo data benchmark",
  },
  { id: "settings.danger-zone", text: "clear all data danger delete reset" },
];

/** True when a card should render — always, unless a search is active and
 * this card didn't match it. */
function sectionMatches(id: string, matchedIds: Set<string> | null) {
  return !matchedIds || matchedIds.has(id);
}

const BUSINESS_SETUP_IDS = [
  "settings.billing",
  "settings.invoice-branding",
  "settings.whatsapp",
];
const DAILY_OPERATIONS_IDS = [
  "settings.turf-rates",
  "settings.snack-items",
  "settings.snack-combos",
  "settings.print",
];
const DATA_SAFETY_IDS = [
  "settings.telegram",
  "settings.backup",
  "settings.archive",
];
const APPEARANCE_IDS = ["settings.theme", "settings.layout"];
const ADVANCED_IDS = [
  "settings.monthly-report",
  "settings.loadtest",
  "settings.danger-zone",
];

/** One named group of settings cards (Business setup, Daily operations, ...).
 * Hidden entirely while searching if none of its cards matched. Still uses a
 * regular `<LayoutSections>` per group, so drag-reorder and show/hide inside
 * "Layout & arrangement" keep working exactly as before — grouping only
 * changes the default on-screen order and adds the label above it. */
function SettingsGroup({
  label,
  ids,
  matchedIds,
  children,
}: {
  label: string;
  ids: string[];
  matchedIds: Set<string> | null;
  children: ReactNode;
}) {
  if (matchedIds && !ids.some((id) => matchedIds.has(id))) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className="h-px flex-1 bg-border" aria-hidden />
      </div>
      <LayoutSections tabId="settings" className="space-y-3">
        {children}
      </LayoutSections>
    </div>
  );
}

export function SettingsTab() {
  const { data: rates = [] } = useTurfRates();
  const { data: items = [] } = useSnackItems();
  const { data: combos = [] } = useSnackCombos();
  const saveRate = useSaveTurfRate();
  const saveItem = useSaveSnackItem();
  const saveCombo = useSaveSnackCombo();

  const rateSort = useSortState<TurfRateSortField>(
    "settings-turf-rates",
    TURF_RATE_SORT_OPTIONS,
    {
      field: "name",
      dir: "asc",
    },
  );
  const sortedRates = useMemo(
    () =>
      [...rates].sort((a, b) => {
        switch (rateSort.field) {
          case "rate":
            return compareBy(a.rate_per_hour, b.rate_per_hour, rateSort.dir);
          case "active":
            return compareActiveFirst(a.is_active, b.is_active, rateSort.dir);
          case "name":
          default:
            return compareBy(
              a.slot_name.toLowerCase(),
              b.slot_name.toLowerCase(),
              rateSort.dir,
            );
        }
      }),
    [rates, rateSort.field, rateSort.dir],
  );

  const itemSort = useSortState<SnackItemSortField>(
    "settings-snack-items",
    SNACK_ITEM_SORT_OPTIONS,
    { field: "name", dir: "asc" },
  );
  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) => {
        switch (itemSort.field) {
          case "category":
            return compareBy(
              a.category.toLowerCase(),
              b.category.toLowerCase(),
              itemSort.dir,
            );
          case "sell":
            return compareBy(a.unit_price, b.unit_price, itemSort.dir);
          case "cost":
            return compareBy(a.cost_price, b.cost_price, itemSort.dir);
          case "active":
            return compareActiveFirst(a.is_active, b.is_active, itemSort.dir);
          case "updated":
            return compareBy(
              a.stock_updated_at ? new Date(a.stock_updated_at).getTime() : 0,
              b.stock_updated_at ? new Date(b.stock_updated_at).getTime() : 0,
              itemSort.dir,
            );
          case "name":
          default:
            return compareBy(
              a.item_name.toLowerCase(),
              b.item_name.toLowerCase(),
              itemSort.dir,
            );
        }
      }),
    [items, itemSort.field, itemSort.dir],
  );

  const comboSort = useSortState<SnackComboSortField>(
    "settings-snack-combos",
    SNACK_COMBO_SORT_OPTIONS,
    { field: "name", dir: "asc" },
  );
  const sortedCombos = useMemo(
    () =>
      [...combos].sort((a, b) => {
        switch (comboSort.field) {
          case "price":
            return compareBy(a.price, b.price, comboSort.dir);
          case "active":
            return compareActiveFirst(a.is_active, b.is_active, comboSort.dir);
          case "name":
          default:
            return compareBy(
              a.name.toLowerCase(),
              b.name.toLowerCase(),
              comboSort.dir,
            );
        }
      }),
    [combos, comboSort.field, comboSort.dir],
  );

  const [newRate, setNewRate] = useState({ slot_name: "", rate_per_hour: "" });
  const [newItem, setNewItem] = useState({
    item_name: "",
    category: "General",
    unit_price: "",
    cost_price: "",
  });
  const [newCombo, setNewCombo] = useState<{
    name: string;
    price: string;
    items: SnackCombo["items"];
  }>({ name: "", price: "", items: [] });

  const [openSections, setOpenSections] = usePersistedState<string[]>(
    "settings-open-sections",
    [],
  );

  const [search, setSearch] = useState("");
  const matchedIds = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    const set = new Set<string>();
    for (const entry of SETTINGS_SEARCH_INDEX) {
      const haystack = entry.text.toLowerCase();
      if (words.every((w) => haystack.includes(w))) set.add(entry.id);
    }
    return set;
  }, [search]);

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="OWNER DESK"
        title="Settings"
        hint="Pricing, menu, branding, printing and backups — all in one place"
        icon={SlidersHorizontal}
      />
      <FirstRunChecklistCard
        onOpenSection={(sectionValue) => {
          setOpenSections((sections) =>
            sections.includes(sectionValue)
              ? sections
              : [...sections, sectionValue],
          );
          // The target card may need a tick to mount/expand before it has a
          // layout to scroll to — same reasoning as CommandPalette's
          // focusSearchWhenReady() poll, just a single frame here since the
          // card is already in the DOM (only the accordion state changes).
          requestAnimationFrame(() => {
            document
              .getElementById(`settings-section-${sectionValue}`)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }}
      />
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search settings — e.g. tax, printer, backup"
          className="pl-9 pr-9"
        />
        {search && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <Accordion
        type="multiple"
        value={
          matchedIds
            ? Array.from(new Set([...openSections, ...matchedIds]))
            : openSections
        }
        onValueChange={setOpenSections}
      >
        <div className="space-y-6">
          <SettingsGroup
            label="Business setup"
            ids={BUSINESS_SETUP_IDS}
            matchedIds={matchedIds}
          >
            {sectionMatches("settings.billing", matchedIds) && (
              <LayoutSection id="settings.billing">
                <SettingsSection
                  value="billing"
                  eyebrow="BILLING"
                  title="Billing & tax"
                  icon={ReceiptIcon}
                >
                  <BillingSettingsCard />
                </SettingsSection>
              </LayoutSection>
            )}
            {sectionMatches("settings.invoice-branding", matchedIds) && (
              <LayoutSection id="settings.invoice-branding">
                <SettingsSection
                  value="invoice-branding"
                  eyebrow="BRANDING"
                  title="Invoice branding"
                  icon={ImageIcon}
                >
                  <InvoiceBrandingCard />
                </SettingsSection>
              </LayoutSection>
            )}
            {sectionMatches("settings.whatsapp", matchedIds) && (
              <LayoutSection id="settings.whatsapp">
                <SettingsSection
                  value="whatsapp"
                  eyebrow="SHARING"
                  title="WhatsApp summary"
                  icon={MessageCircle}
                >
                  <WhatsAppSummaryCard />
                </SettingsSection>
              </LayoutSection>
            )}
          </SettingsGroup>

          <SettingsGroup
            label="Daily operations"
            ids={DAILY_OPERATIONS_IDS}
            matchedIds={matchedIds}
          >
            {sectionMatches("settings.turf-rates", matchedIds) && (
              <LayoutSection id="settings.turf-rates">
                <SettingsSection
                  value="turf-rates"
                  eyebrow="PRICING"
                  title="Turf rates"
                  icon={Trophy}
                  action={
                    rates.length > 0 ? (
                      <SortMenu
                        options={TURF_RATE_SORT_OPTIONS}
                        field={rateSort.field}
                        dir={rateSort.dir}
                        onFieldChange={rateSort.setField}
                        onToggleDir={rateSort.toggleDir}
                      />
                    ) : undefined
                  }
                >
                  <SlotDurationsCard />
                  <Card className="frost">
                    <CardContent className="space-y-3 p-4">
                      {sortedRates.map((r) => (
                        <TurfRateRow key={r.id} rate={r} />
                      ))}

                      <div className="frost-well grid grid-cols-2 gap-2 rounded-xl border border-dashed p-3 md:grid-cols-[1fr_140px_auto] md:items-center">
                        <div className="space-y-1">
                          <Label className="micro-label">New slot</Label>
                          <Input
                            value={newRate.slot_name}
                            onChange={(e) =>
                              setNewRate({
                                ...newRate,
                                slot_name: e.target.value,
                              })
                            }
                            placeholder="e.g. Weekend Night"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="micro-label">Rate / hr</Label>
                          <Input
                            inputMode="decimal"
                            value={newRate.rate_per_hour}
                            onChange={(e) =>
                              setNewRate({
                                ...newRate,
                                rate_per_hour: e.target.value,
                              })
                            }
                            placeholder="1200"
                          />
                        </div>
                        <Button
                          className="col-span-2 md:col-span-1 md:mt-5"
                          onClick={() => {
                            if (!newRate.slot_name.trim()) {
                              toast.error("Slot name required");
                              return;
                            }
                            saveRate.mutate(
                              {
                                slot_name: newRate.slot_name.trim(),
                                rate_per_hour:
                                  Number(newRate.rate_per_hour) || 0,
                                is_active: true,
                              },
                              {
                                onSuccess: () => {
                                  setNewRate({
                                    slot_name: "",
                                    rate_per_hour: "",
                                  });
                                  toast.success("Slot added");
                                },
                              },
                            );
                          }}
                        >
                          <Plus className="mr-1 h-4 w-4" /> Add slot
                        </Button>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        Defaults: Weekdays {money(1200)}/hr · Weekends{" "}
                        {money(1400)}
                        /hr — edit anytime.
                      </p>
                    </CardContent>
                  </Card>
                </SettingsSection>
              </LayoutSection>
            )}
            {sectionMatches("settings.snack-items", matchedIds) && (
              <LayoutSection id="settings.snack-items">
                <SettingsSection
                  value="snack-items"
                  eyebrow="MENU"
                  title="Snack items"
                  icon={Cookie}
                  action={
                    items.length > 0 ? (
                      <SortMenu
                        options={SNACK_ITEM_SORT_OPTIONS}
                        field={itemSort.field}
                        dir={itemSort.dir}
                        onFieldChange={itemSort.setField}
                        onToggleDir={itemSort.toggleDir}
                      />
                    ) : undefined
                  }
                >
                  <Card className="frost">
                    <CardContent className="space-y-3 p-4">
                      {sortedItems.map((i) => (
                        <SnackItemRow key={i.id} item={i} />
                      ))}

                      <div className="frost-well grid grid-cols-2 gap-2 rounded-xl border border-dashed p-3 md:grid-cols-[1.4fr_1fr_110px_110px_auto] md:items-end">
                        <div className="space-y-1">
                          <Label className="micro-label">Item</Label>
                          <Input
                            value={newItem.item_name}
                            onChange={(e) =>
                              setNewItem({
                                ...newItem,
                                item_name: e.target.value,
                              })
                            }
                            placeholder="e.g. Tea"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="micro-label">Category</Label>
                          <Input
                            value={newItem.category}
                            onChange={(e) =>
                              setNewItem({
                                ...newItem,
                                category: e.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="micro-label">Sell ₹</Label>
                          <Input
                            inputMode="decimal"
                            value={newItem.unit_price}
                            onChange={(e) =>
                              setNewItem({
                                ...newItem,
                                unit_price: e.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="micro-label">Cost ₹</Label>
                          <Input
                            inputMode="decimal"
                            value={newItem.cost_price}
                            onChange={(e) =>
                              setNewItem({
                                ...newItem,
                                cost_price: e.target.value,
                              })
                            }
                          />
                        </div>
                        <Button
                          className="col-span-2 md:col-span-1"
                          onClick={() => {
                            if (!newItem.item_name.trim()) {
                              toast.error("Item name required");
                              return;
                            }
                            saveItem.mutate(
                              {
                                item_name: newItem.item_name.trim(),
                                category: newItem.category || "General",
                                unit_price: Number(newItem.unit_price) || 0,
                                cost_price: Number(newItem.cost_price) || 0,
                                is_active: true,
                              },
                              {
                                onSuccess: () => {
                                  setNewItem({
                                    item_name: "",
                                    category: "General",
                                    unit_price: "",
                                    cost_price: "",
                                  });
                                  toast.success("Item added");
                                },
                              },
                            );
                          }}
                        >
                          <Plus className="mr-1 h-4 w-4" /> Add item
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </SettingsSection>
              </LayoutSection>
            )}
            {sectionMatches("settings.snack-combos", matchedIds) && (
              <LayoutSection id="settings.snack-combos">
                <SettingsSection
                  value="snack-combos"
                  eyebrow="MENU"
                  title="Snack combos"
                  icon={Layers}
                  action={
                    combos.length > 0 ? (
                      <SortMenu
                        options={SNACK_COMBO_SORT_OPTIONS}
                        field={comboSort.field}
                        dir={comboSort.dir}
                        onFieldChange={comboSort.setField}
                        onToggleDir={comboSort.toggleDir}
                      />
                    ) : undefined
                  }
                >
                  <Card className="frost">
                    <CardContent className="space-y-3 p-4">
                      {sortedCombos.map((c) => (
                        <ComboRow key={c.id} combo={c} snackItems={items} />
                      ))}

                      <div className="frost-well space-y-3 rounded-xl border border-dashed p-3">
                        <div className="grid grid-cols-2 gap-2 md:grid-cols-[1.4fr_140px_auto] md:items-end">
                          <div className="space-y-1">
                            <Label className="micro-label">
                              New combo name
                            </Label>
                            <Input
                              value={newCombo.name}
                              onChange={(e) =>
                                setNewCombo({
                                  ...newCombo,
                                  name: e.target.value,
                                })
                              }
                              placeholder="e.g. Tea + Bun"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="micro-label">Combo price ₹</Label>
                            <Input
                              inputMode="decimal"
                              value={newCombo.price}
                              onChange={(e) =>
                                setNewCombo({
                                  ...newCombo,
                                  price: e.target.value,
                                })
                              }
                            />
                          </div>
                          <Button
                            className="col-span-2 md:col-span-1"
                            onClick={() => {
                              if (!newCombo.name.trim()) {
                                toast.error("Combo name required");
                                return;
                              }
                              if (newCombo.items.length === 0) {
                                toast.error("Add at least one item");
                                return;
                              }
                              saveCombo.mutate(
                                {
                                  name: newCombo.name.trim(),
                                  price: Number(newCombo.price) || 0,
                                  items: newCombo.items,
                                  is_active: true,
                                },
                                {
                                  onSuccess: () => {
                                    setNewCombo({
                                      name: "",
                                      price: "",
                                      items: [],
                                    });
                                    toast.success("Combo added");
                                  },
                                },
                              );
                            }}
                          >
                            <Plus className="mr-1 h-4 w-4" /> Add combo
                          </Button>
                        </div>
                        <ComboItemsEditor
                          items={newCombo.items}
                          onChange={(its) =>
                            setNewCombo({ ...newCombo, items: its })
                          }
                          snackItems={items}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </SettingsSection>
              </LayoutSection>
            )}
            {sectionMatches("settings.print", matchedIds) && (
              <LayoutSection id="settings.print">
                <SettingsSection
                  value="print"
                  eyebrow="RECEIPTS"
                  title="Printer & receipt format"
                  icon={Printer}
                >
                  <PrintSettingsCard />
                </SettingsSection>
              </LayoutSection>
            )}
          </SettingsGroup>

          <SettingsGroup
            label="Data safety"
            ids={DATA_SAFETY_IDS}
            matchedIds={matchedIds}
          >
            {sectionMatches("settings.telegram", matchedIds) && (
              <LayoutSection id="settings.telegram">
                <SettingsSection
                  value="telegram"
                  eyebrow="DATA SAFETY"
                  title="Cloud backup (Telegram)"
                  icon={SendIcon}
                >
                  <TelegramBackupCard />
                </SettingsSection>
              </LayoutSection>
            )}
            {sectionMatches("settings.backup", matchedIds) && (
              <LayoutSection id="settings.backup">
                <SettingsSection
                  value="backup"
                  eyebrow="DATA SAFETY"
                  title="Backup & restore"
                  icon={DownloadIcon}
                >
                  <BackupCard />
                </SettingsSection>
              </LayoutSection>
            )}
            {sectionMatches("settings.archive", matchedIds) && (
              <LayoutSection id="settings.archive">
                <SettingsSection
                  value="archive"
                  eyebrow="DATA LIFECYCLE"
                  title="Year archive"
                  icon={ArchiveIcon}
                >
                  <ArchiveCard />
                </SettingsSection>
              </LayoutSection>
            )}
          </SettingsGroup>

          <SettingsGroup
            label="Appearance"
            ids={APPEARANCE_IDS}
            matchedIds={matchedIds}
          >
            {sectionMatches("settings.theme", matchedIds) && (
              <LayoutSection id="settings.theme">
                <SettingsSection
                  value="theme"
                  eyebrow="LOOK & FEEL"
                  title="Appearance & theme"
                  icon={Palette}
                >
                  <ThemeCustomizerCard />
                </SettingsSection>
              </LayoutSection>
            )}
            {sectionMatches("settings.layout", matchedIds) && (
              <LayoutSection id="settings.layout">
                <SettingsSection
                  value="layout"
                  eyebrow="ARRANGEMENT"
                  title="Layout & arrangement"
                  hint="Hide, reorder and save arrangements of tabs and blocks"
                  icon={LayoutDashboard}
                >
                  <LayoutSettingsCard />
                </SettingsSection>
              </LayoutSection>
            )}
          </SettingsGroup>

          <SettingsGroup
            label="Advanced"
            ids={ADVANCED_IDS}
            matchedIds={matchedIds}
          >
            {sectionMatches("settings.monthly-report", matchedIds) && (
              <LayoutSection id="settings.monthly-report">
                <SettingsSection
                  value="monthly-report"
                  eyebrow="REMINDERS"
                  title="Monthly report"
                  icon={CalendarClock}
                >
                  <MonthlyReportCard />
                </SettingsSection>
              </LayoutSection>
            )}
            {sectionMatches("settings.loadtest", matchedIds) && (
              <LayoutSection id="settings.loadtest">
                <SettingsSection
                  value="loadtest"
                  eyebrow="TESTING"
                  title="Load test"
                  hint="Seed one realistic year of demo data, benchmark the app on it, remove it again"
                  icon={FlaskConical}
                >
                  <LoadTestCard />
                </SettingsSection>
              </LayoutSection>
            )}
            {sectionMatches("settings.danger-zone", matchedIds) && (
              <LayoutSection id="settings.danger-zone">
                <SettingsSection
                  value="danger-zone"
                  eyebrow="DANGER ZONE"
                  title="Clear all data"
                  icon={AlertTriangle}
                >
                  <ClearAllDataCard />
                </SettingsSection>
              </LayoutSection>
            )}
          </SettingsGroup>

          {matchedIds && matchedIds.size === 0 && (
            <p className="frost-well rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No settings match “{search.trim()}”. Try a different word, or{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => setSearch("")}
              >
                clear the search
              </button>
              .
            </p>
          )}
        </div>
      </Accordion>
    </div>
  );
}
