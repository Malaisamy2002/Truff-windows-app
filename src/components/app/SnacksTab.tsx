import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Minus,
  Trash2,
  ReceiptText,
  Repeat,
  RotateCcw,
  Cookie,
  ShoppingBasket,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "@/components/app/SectionHeading";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  bookingGrossTotal,
  formatDMY,
  money,
  snackSaleGrossTotal,
} from "@/lib/biz";
import { rupees } from "@/lib/money";
import { isFinancialBooking } from "@/lib/analytics";
import { usePrintSettings } from "@/lib/print";
import { snackSaleReceipt, printReceipt } from "@/lib/receipt";
import { INVOICE_SECTIONS } from "@/lib/desktop";
import { CustomerFields } from "./CustomerFields";
import { SnackSalesList } from "./SnackSalesList";
import {
  LayoutSection,
  LayoutSections,
  LayoutPart,
  LayoutParts,
} from "./LayoutSection";

import {
  SNACK_PAYMENT_MODES,
  TAB_PAYMENT_MODE,
  useCreateSnackSale,
  useSnackCombos,
  useSnackItems,
  useSnackSales,
  useTurfBookings,
  type SnackCombo,
  type SnackSaleItem,
} from "@/lib/ops";
import { useAddTabEntry } from "@/lib/tabs";

import {
  frequentItemsForCustomer,
  lastOrderForCustomer,
} from "@/lib/customer-favorites";
import { addCartLine, setCartLineQty } from "@/lib/cart";
import { SnackStockCard } from "./SnackStockCard";
import { PopularSnacksCard } from "./PopularSnacksCard";
import { localDateStr } from "@/lib/utils";

const today = () => localDateStr();

type SnacksTabProps = {
  /**
   * Set by the Customers tab's "New sale" row action (via `goToTab` in
   * `lib/nav.ts`) — name/phone to drop straight into a fresh sale's
   * customer fields. `null`/absent means no hand-off is pending.
   */
  prefillCustomer?: { name: string; phone: string | null } | null;
  /** Called once the prefill above has been applied, so the caller (routes/
   * index.tsx) can clear it and a later tab switch doesn't reapply it. */
  onConsumePrefillCustomer?: () => void;
};

/** Snacks-only billing: create a snack bill at the top, saved snack bills below. */
export function SnacksTab({
  prefillCustomer,
  onConsumePrefillCustomer,
}: SnacksTabProps = {}) {
  const { data: snackItems = [] } = useSnackItems();
  const { data: combos = [] } = useSnackCombos();
  const { data: bookings = [] } = useTurfBookings();
  const { data: snackSales = [] } = useSnackSales();
  const create = useCreateSnackSale();
  const { settings: printSettings } = usePrintSettings();
  const addTabEntry = useAddTabEntry();

  const activeSnacks = snackItems.filter((i) => i.is_active);
  const activeCombos = combos.filter((c) => c.is_active);
  const linkableBookings = bookings.filter(isFinancialBooking).slice(0, 30);

  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [saleDate, setSaleDate] = useState(today());
  const [paymentMode, setPaymentMode] = useState<string>("Cash");
  const [notes, setNotes] = useState("");
  const [itemName, setItemName] = useState("");
  const [qty, setQty] = useState("1");
  const [cart, setCart] = useState<SnackSaleItem[]>([]);
  const [bookingId, setBookingId] = useState<string>("none");
  /** Controls the searchable item picker's open/closed state. */
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  /** Category chip filter for the quick-add grid below. "All" shows every
   * active item; anything else narrows to that item's `category` field. */
  const [activeCategory, setActiveCategory] = useState("All");
  /** Free-typed text for a cart row's qty box while it's being edited, keyed by
   * item+price so the field can be cleared and retyped without the row
   * disappearing mid-keystroke (a blank/zero value only commits on blur/Enter). */
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  const cartRowKey = (r: SnackSaleItem) => `${r.item_name}__${r.unit_price}`;
  const qtyInputRef = useRef<HTMLInputElement>(null);
  /** Scroll target for the sticky cart bar's "Generate bill" shortcut, so
   * tapping it while scrolled down in the catalogue brings the customer /
   * payment-mode / save card back into view. */
  const topCardRef = useRef<HTMLDivElement>(null);

  /**
   * Applies a pending Customers-tab hand-off: fills the new-sale form's
   * customer/phone fields and scrolls the sale card into view. Runs once
   * per hand-off (guarded by the `prefillCustomer` dependency going back to
   * null after `onConsumePrefillCustomer` fires), so it won't refire on
   * unrelated re-renders or clobber a sale already in progress.
   */
  useEffect(() => {
    if (!prefillCustomer) return;
    setCustomer(prefillCustomer.name);
    setPhone(prefillCustomer.phone ?? "");
    topCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    onConsumePrefillCustomer?.();
  }, [prefillCustomer, onConsumePrefillCustomer]);

  const picked = activeSnacks.find((i) => i.item_name === itemName);
  const lineAmount = (Number(qty) || 0) * (picked?.unit_price ?? 0);
  const total = cart.reduce((s, r) => s + r.amount, 0);
  const profit = cart.reduce(
    (s, r) => s + (r.amount - r.qty * r.cost_price),
    0,
  );
  const linkedBooking = linkableBookings.find((b) => b.id === bookingId);

  /** Items this customer has bought before, most-repeated first — powers the
   * one-tap "usually orders" row below. Ranking logic lives in
   * lib/customer-favorites.ts, so tuning it never touches this component. */
  const frequentItems = useMemo(
    () => frequentItemsForCustomer(snackSales, customer),
    [snackSales, customer],
  );

  /** This customer's most recent bill, if any — powers the one-tap "Repeat
   * last order" button (whole order at once, vs. the per-item chips above). */
  const lastOrder = useMemo(
    () => lastOrderForCustomer(snackSales, customer),
    [snackSales, customer],
  );

  /** Distinct categories among active items, "All" first, so the quick-add
   * grid below can be filtered by chip instead of typed search. */
  const categories = useMemo(() => {
    const set = new Set(activeSnacks.map((i) => i.category || "General"));
    return ["All", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [activeSnacks]);

  const visibleSnacks = useMemo(
    () =>
      activeCategory === "All"
        ? activeSnacks
        : activeSnacks.filter(
            (i) => (i.category || "General") === activeCategory,
          ),
    [activeSnacks, activeCategory],
  );

  /** Top 6 items by quantity sold in the last 7 days, shop-wide (not
   * customer-specific — see `frequentItems` above for that). Same "most
   * sold" ranking `PopularSnacksCard`'s chart uses, just surfaced here as
   * one-tap buttons instead of a chart further down the page. */
  const popularThisWeek = useMemo(() => {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const from = localDateStr(since);
    const byItem = new Map<string, number>();
    for (const s of snackSales) {
      if (s.sale_date < from) continue;
      for (const line of s.items ?? []) {
        byItem.set(
          line.item_name,
          (byItem.get(line.item_name) ?? 0) + (Number(line.qty) || 0),
        );
      }
    }
    return Array.from(byItem.entries())
      .filter(([name]) => activeSnacks.some((i) => i.item_name === name))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name]) => name);
  }, [snackSales, activeSnacks]);

  /** Adds a past item straight to the cart at qty 1 — merges into an existing
   * row for the same item instead of creating a duplicate (see lib/cart.ts). */
  const quickAddItem = (name: string) => {
    const item = activeSnacks.find((i) => i.item_name === name);
    if (!item) {
      toast.error(`${name} isn't available right now`);
      return;
    }
    setCart((c) =>
      addCartLine(c, {
        item_name: item.item_name,
        qty: 1,
        unit_price: item.unit_price,
        cost_price: item.cost_price,
        amount: item.unit_price,
      }),
    );
  };

  /** One-tap combo: adds each component, priced down to the combo price. */
  const addCombo = (combo: SnackCombo) => {
    const lines = combo.items
      .map((ci) => {
        const item = activeSnacks.find((i) => i.item_name === ci.item_name);
        if (!item) return null;
        return { item, qty: Math.max(1, Number(ci.qty) || 1) };
      })
      .filter(Boolean) as {
      item: (typeof activeSnacks)[number];
      qty: number;
    }[];

    if (lines.length === 0) {
      toast.error(`${combo.name} has no available items`);
      return;
    }

    const listTotal =
      lines.reduce((s, l) => s + l.qty * l.item.unit_price, 0) || 1;
    let left = combo.price;
    const rows: SnackSaleItem[] = lines.map((l, idx) => {
      const share =
        idx === lines.length - 1
          ? left
          : Math.round((l.qty * l.item.unit_price * combo.price) / listTotal);
      left -= share;
      return {
        item_name: l.item.item_name,
        qty: l.qty,
        // rupees() at the source, defense in depth — `amount` (share) was
        // already whole, but this display field could otherwise store a
        // fractional rupee (e.g. a ₹51 share split across 2 units → 25.5).
        unit_price: l.qty ? rupees(share / l.qty) : share,
        cost_price: l.item.cost_price,
        amount: share,
      };
    });
    setCart((c) => rows.reduce((acc, row) => addCartLine(acc, row), c));
    toast.success(`${combo.name} added`);
  };

  /** One-tap "repeat last order": adds every line from this customer's most
   * recent bill to the cart at *current* prices/cost (never the historical
   * ones on the old bill, so a since-changed price doesn't silently
   * undercharge or overcharge). Items no longer in the active catalogue are
   * skipped rather than blocking the whole action. */
  const repeatLastOrder = () => {
    if (!lastOrder || lastOrder.items.length === 0) return;
    const matched: SnackSaleItem[] = [];
    let skipped = 0;
    for (const line of lastOrder.items) {
      const item = activeSnacks.find((i) => i.item_name === line.item_name);
      if (!item) {
        skipped += 1;
        continue;
      }
      matched.push({
        item_name: item.item_name,
        qty: line.qty,
        unit_price: item.unit_price,
        cost_price: item.cost_price,
        amount: line.qty * item.unit_price,
      });
    }
    if (matched.length === 0) {
      toast.error("None of the items from the last order are available now");
      return;
    }
    setCart((c) => matched.reduce((acc, row) => addCartLine(acc, row), c));
    toast.success(
      skipped > 0
        ? `Last order added — ${skipped} item${skipped === 1 ? "" : "s"} no longer available`
        : `${lastOrder.bill_no}'s items added to cart`,
    );
  };

  const addLine = () => {
    if (!picked) {
      toast.error("Pick an item");
      return;
    }
    const q = Number(qty) || 0;
    if (q <= 0) {
      toast.error("Qty must be more than 0");
      return;
    }
    setCart((c) =>
      addCartLine(c, {
        item_name: picked.item_name,
        qty: q,
        unit_price: picked.unit_price,
        cost_price: picked.cost_price,
        amount: q * picked.unit_price,
      }),
    );
    setQty("1");
    // Snacks shortcut: keep focus (and the text selected) in Qty after
    // adding, so pressing Enter repeatedly adds line after line without
    // ever reaching for the mouse.
    requestAnimationFrame(() => {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    });
  };

  /** Commits a typed cart-row qty on blur/Enter — clears the draft and either
   * updates the row or removes it (0/blank), same as the +/− steppers. */
  const commitQtyDraft = (idx: number, raw: string) => {
    const row = cart[idx];
    if (!row) return;
    const key = cartRowKey(row);
    setQtyDrafts((d) => {
      const { [key]: _omit, ...rest } = d;
      return rest;
    });
    const parsed = Math.floor(Number(raw));
    setCart((c) =>
      setCartLineQty(c, idx, Number.isFinite(parsed) ? parsed : 0),
    );
  };

  /** +/− steppers bypass any in-progress typed draft for that row. */
  const stepQty = (idx: number, next: number) => {
    const row = cart[idx];
    if (!row) return;
    const key = cartRowKey(row);
    setQtyDrafts((d) => {
      const { [key]: _omit, ...rest } = d;
      return rest;
    });
    setCart((c) => setCartLineQty(c, idx, next));
  };

  const generateBill = () => {
    if (cart.length === 0) {
      toast.error("Add at least one snack");
      return;
    }
    // Customer name is required on every snack bill (receipts, history, and
    // "on tab" dues all need at least a name). Phone is optional everywhere,
    // including "on tab" — the tab's identity key already falls back to name
    // when no phone is given (lib/tabs.ts tabKey()), same as turf bookings
    // already allow (TurfTab.tsx's submit() only requires phone to be
    // 10 digits *if* one is entered, never that one exists).
    const billName = customer.trim() || linkedBooking?.customer_name || "";
    const billPhone = phone.trim() || linkedBooking?.phone || "";
    if (!billName) {
      toast.error("Enter customer name to generate the bill");
      return;
    }
    if (billPhone && !/^\d{10}$/.test(billPhone)) {
      toast.error("Phone must be 10 digits");
      return;
    }
    const onTab = paymentMode === TAB_PAYMENT_MODE;
    create.mutate(
      {
        sale_date: saleDate,
        customer_name: billName || null,
        items: cart,
        total,
        profit,
        payment_mode: paymentMode,
        notes: notes.trim() || null,
        booking_id: linkedBooking?.id ?? null,
        booking_no: linkedBooking?.booking_no ?? null,
      },
      {
        onSuccess: (saved) => {
          toast.success(`Bill ${saved.bill_no} created`);
          if (printSettings.autoPrint)
            printReceipt(
              snackSaleReceipt(saved),
              printSettings,
              INVOICE_SECTIONS.snacks,
            );
          // Push the bill total onto the customer's running tab as a Snacks charge,
          // linked back to the sale so the ledger row can be traced to the bill.
          if (onTab) {
            addTabEntry.mutate(
              {
                name: billName,
                phone: billPhone,
                kind: "charge",
                business: "Snacks",
                // The tab is charged the same tax-inclusive grand total the
                // receipt just printed (lib/biz.ts snackSaleGrossTotal).
                amount: snackSaleGrossTotal(saved),
                note: `Snack bill ${saved.bill_no}`,
                ref_type: "snack_sale",
                ref_id: saved.id,
                entry_date: saved.sale_date,
              },
              {
                onSuccess: () =>
                  toast.success(
                    `${money(snackSaleGrossTotal(saved))} added to ${billName}'s tab`,
                  ),
                onError: (e) => toast.error(e.message),
              },
            );
          }
          setCart([]);
          setCustomer("");
          setPhone("");
          setNotes("");
          setBookingId("none");
          setPaymentMode("Cash");
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="SELL"
        title="Sell snacks"
        hint="Quick-add from the catalogue, bill, stock and sales — all in one place"
        icon={Cookie}
      />

      <LayoutSections tabId="snacks" className="space-y-6">
        <LayoutSection id="snacks.new-bill">
          {/* Generate bill — kept at the very top of the page */}
          <Card ref={topCardRef} className="frost lift border-primary/30">
            <CardContent className="space-y-4">
              <SectionHeading
                icon={ReceiptText}
                eyebrow="New"
                title="Generate snack bill"
              />
              <LayoutParts sectionId="snacks.new-bill" className="space-y-4">
                <LayoutPart id="snacks.new-bill.customer">
                  <CustomerFields
                    name={customer}
                    phone={phone}
                    onChange={({ name, phone: p }) => {
                      setCustomer(name);
                      setPhone(p);
                    }}
                    nameLabel="Customer name"
                  />
                  {!customer.trim() && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => setCustomer("Walk-in")}
                    >
                      Walk-in customer
                    </Button>
                  )}
                </LayoutPart>

                <LayoutPart id="snacks.new-bill.frequent">
                  {lastOrder && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="mb-1.5"
                      onClick={repeatLastOrder}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" />
                      Repeat last order · {lastOrder.bill_no} (
                      {money(lastOrder.total)})
                    </Button>
                  )}
                  {frequentItems.length > 0 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Usually orders
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {frequentItems.map((f) => (
                          <Button
                            key={f.item_name}
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => quickAddItem(f.item_name)}
                          >
                            <Repeat className="mr-1 h-3.5 w-3.5" />
                            {f.item_name} · {f.timesBought}×
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </LayoutPart>

                <LayoutParts
                  sectionId="snacks.new-bill"
                  className="grid gap-3 md:grid-cols-3"
                >
                  <LayoutPart id="snacks.new-bill.date" className="space-y-1">
                    <Label className="text-xs">Date</Label>
                    <Input
                      type="date"
                      value={saleDate}
                      onChange={(e) => setSaleDate(e.target.value)}
                    />
                  </LayoutPart>
                  <LayoutPart
                    id="snacks.new-bill.payment-mode"
                    className="space-y-1"
                  >
                    <Label className="text-xs">Payment mode</Label>
                    <Select value={paymentMode} onValueChange={setPaymentMode}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SNACK_PAYMENT_MODES.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </LayoutPart>
                  <LayoutPart id="snacks.new-bill.total" className="space-y-1">
                    <Label className="text-xs">Total (auto)</Label>
                    <Input
                      readOnly
                      disabled
                      value={money(total)}
                      className="font-semibold"
                    />
                  </LayoutPart>
                </LayoutParts>

                <LayoutPart
                  id="snacks.new-bill.link-booking"
                  className="space-y-1"
                >
                  <Label className="text-xs">
                    Link to turf booking (optional)
                  </Label>
                  <Select value={bookingId} onValueChange={setBookingId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Not linked" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not linked</SelectItem>
                      {linkableBookings.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.booking_no} · {b.customer_name} ·{" "}
                          {formatDMY(b.booking_date)}
                          {b.start_time ? ` ${b.start_time}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {linkedBooking && (
                    <p className="text-xs text-muted-foreground">
                      Combined bill: turf{" "}
                      {money(bookingGrossTotal(linkedBooking))} + snacks{" "}
                      {money(total)} ={" "}
                      <span className="font-medium text-foreground">
                        {money(bookingGrossTotal(linkedBooking) + total)}
                      </span>
                    </p>
                  )}
                </LayoutPart>

                <LayoutPart id="snacks.new-bill.notes" className="space-y-1">
                  <Label className="text-xs">Notes</Label>
                  <Textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional note for this bill"
                  />
                </LayoutPart>

                <LayoutPart id="snacks.new-bill.save">
                  <Button
                    className="h-12 w-full"
                    onClick={generateBill}
                    disabled={create.isPending}
                    data-shortcut="save"
                  >
                    <ReceiptText className="mr-1 h-5 w-5" /> Generate bill ·{" "}
                    {money(total)}
                  </Button>
                </LayoutPart>
              </LayoutParts>
            </CardContent>
          </Card>
        </LayoutSection>

        <LayoutSection id="snacks.catalogue">
          <Card>
            <CardContent className="space-y-3">
              <SectionHeading
                icon={ShoppingBasket}
                eyebrow="Catalogue"
                title="Add snacks"
              />
              <LayoutParts sectionId="snacks.catalogue" className="space-y-3">
                <LayoutPart id="snacks.catalogue.popular">
                  {popularThisWeek.length > 0 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Popular this week
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {popularThisWeek.map((name) => (
                          <Button
                            key={name}
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => quickAddItem(name)}
                          >
                            {name}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </LayoutPart>

                <LayoutPart id="snacks.catalogue.combos">
                  {activeCombos.length > 0 && (
                    <div className="frost-soft space-y-2 rounded-xl border border-primary/30 p-3">
                      <p className="micro-label">Combo deals — one tap</p>
                      <div className="flex flex-wrap gap-2">
                        {activeCombos.map((c) => (
                          <Button
                            key={c.id}
                            size="sm"
                            variant="secondary"
                            onClick={() => addCombo(c)}
                          >
                            {c.name} · {money(c.price)}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </LayoutPart>

                <LayoutPart id="snacks.catalogue.grid" className="space-y-2">
                  {activeSnacks.length > 0 && (
                    <>
                      {categories.length > 2 && (
                        <div className="flex flex-wrap gap-1.5">
                          {categories.map((cat) => (
                            <Button
                              key={cat}
                              type="button"
                              size="sm"
                              variant={
                                activeCategory === cat ? "default" : "outline"
                              }
                              className="h-7 px-3 text-xs"
                              onClick={() => setActiveCategory(cat)}
                            >
                              {cat}
                            </Button>
                          ))}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                        {visibleSnacks.map((i) => {
                          const outOfStock = i.stock_quantity <= 0;
                          const lowStock =
                            !outOfStock &&
                            i.stock_quantity <= i.low_stock_threshold;
                          return (
                            <button
                              key={i.id}
                              type="button"
                              disabled={outOfStock}
                              onClick={() => quickAddItem(i.item_name)}
                              className={cn(
                                "frost-soft flex flex-col items-start gap-0.5 rounded-xl border p-2.5 text-left transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50",
                              )}
                            >
                              <span className="w-full truncate text-sm font-medium">
                                {i.item_name}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {money(i.unit_price)}
                              </span>
                              {outOfStock ? (
                                <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                                  Out of stock
                                </span>
                              ) : lowStock ? (
                                <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                                  Low stock · {i.stock_quantity} left
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-center text-[11px] text-muted-foreground">
                        Tap an item to add one. Need a specific quantity? Use
                        the search box below.
                      </p>
                    </>
                  )}
                </LayoutPart>

                <LayoutPart id="snacks.catalogue.picker" className="space-y-3">
                  <div className="grid items-end gap-3 md:grid-cols-4">
                    <div className="space-y-1 md:col-span-2">
                      <Label className="text-xs">Item</Label>
                      <Popover
                        open={itemPickerOpen}
                        onOpenChange={setItemPickerOpen}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={itemPickerOpen}
                            className="w-full justify-between font-normal"
                            disabled={activeSnacks.length === 0}
                          >
                            <span className="truncate">
                              {picked
                                ? `${picked.item_name} — ${money(picked.unit_price)} · ${picked.stock_quantity} left`
                                : activeSnacks.length
                                  ? "Select item"
                                  : "Add items in Settings"}
                            </span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-[--radix-popover-trigger-width] p-0"
                          align="start"
                        >
                          <Command
                            filter={(value, search) =>
                              value.toLowerCase().includes(search.toLowerCase())
                                ? 1
                                : 0
                            }
                          >
                            <CommandInput placeholder="Search snacks…" />
                            <CommandList>
                              <CommandEmpty>No snack found.</CommandEmpty>
                              <CommandGroup>
                                {activeSnacks.map((i) => (
                                  <CommandItem
                                    key={i.id}
                                    value={i.item_name}
                                    onSelect={(value) => {
                                      setItemName(
                                        value === itemName ? "" : value,
                                      );
                                      setItemPickerOpen(false);
                                      requestAnimationFrame(() => {
                                        qtyInputRef.current?.focus();
                                        qtyInputRef.current?.select();
                                      });
                                    }}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        itemName === i.item_name
                                          ? "opacity-100"
                                          : "opacity-0",
                                      )}
                                    />
                                    <span className="flex-1 truncate">
                                      {i.item_name} — {money(i.unit_price)} ·{" "}
                                      {i.stock_quantity} left
                                    </span>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Qty</Label>
                      <Input
                        ref={qtyInputRef}
                        type="number"
                        min={0}
                        step={1}
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addLine();
                          }
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Amount (auto)</Label>
                      <Input readOnly disabled value={money(lineAmount)} />
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={addLine}
                  >
                    <Plus className="mr-1 h-4 w-4" /> Add item
                  </Button>
                </LayoutPart>

                <LayoutPart id="snacks.catalogue.tip">
                  <p className="text-center text-[11px] text-muted-foreground">
                    Tip: pick an item, type the qty, then press{" "}
                    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">
                      Enter
                    </kbd>{" "}
                    to add it instantly and keep going.
                  </p>
                </LayoutPart>

                <LayoutPart id="snacks.catalogue.cart">
                  {cart.length > 0 && (
                    <div className="frost-well space-y-2 rounded-xl border p-3">
                      {cart.map((r, idx) => {
                        const key = cartRowKey(r);
                        return (
                          <div
                            key={idx}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            <span className="flex-1 truncate">
                              {r.item_name} · {money(r.unit_price)} each
                            </span>
                            <div className="flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-7"
                                aria-label="Decrease quantity"
                                onClick={() => stepQty(idx, r.qty - 1)}
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </Button>
                              <Input
                                type="number"
                                min={1}
                                value={qtyDrafts[key] ?? String(r.qty)}
                                onFocus={() =>
                                  setQtyDrafts((d) => ({
                                    ...d,
                                    [key]: String(r.qty),
                                  }))
                                }
                                onChange={(e) =>
                                  setQtyDrafts((d) => ({
                                    ...d,
                                    [key]: e.target.value,
                                  }))
                                }
                                onBlur={(e) =>
                                  commitQtyDraft(idx, e.target.value)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")
                                    (e.target as HTMLInputElement).blur();
                                }}
                                className="h-8 w-14 text-center"
                              />
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-7"
                                aria-label="Increase quantity"
                                onClick={() => stepQty(idx, r.qty + 1)}
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            <span className="flex w-24 items-center justify-end gap-2 font-medium">
                              {money(r.amount)}
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-8"
                                aria-label="Remove item"
                                onClick={() =>
                                  setCart(cart.filter((_, i) => i !== idx))
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </span>
                          </div>
                        );
                      })}
                      <div className="flex justify-between border-t pt-2 text-sm font-semibold">
                        <span>Snacks total</span>
                        <span className="stat-value">{money(total)}</span>
                      </div>
                    </div>
                  )}
                </LayoutPart>
              </LayoutParts>
            </CardContent>
          </Card>
        </LayoutSection>

        <LayoutSection id="snacks.stock">
          <SnackStockCard />
        </LayoutSection>

        <LayoutSection id="snacks.popular">
          <PopularSnacksCard />
        </LayoutSection>

        <LayoutSection id="snacks.sales">
          <SnackSalesList />
        </LayoutSection>
      </LayoutSections>

      {/* Sticky cart summary: keeps the running total (and a one-tap
       * checkout) on screen while scrolling the catalogue below, on both
       * Android (a full-width bar above the bottom nav) and Windows (a
       * docked bar in the corner). Mirrors the top card's own "Generate
       * bill" button/validation, so this is a shortcut to it, not a second
       * code path. */}
      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom)+0.5rem)] z-30 flex justify-center px-3 md:inset-x-auto md:right-6 md:bottom-6 md:px-0">
          <div className="frost lift flex w-full max-w-md items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 shadow-lg md:w-auto md:min-w-[24rem]">
            <button
              type="button"
              className="flex min-w-0 flex-col items-start text-left"
              onClick={() =>
                topCardRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                })
              }
            >
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {cart.length} item{cart.length === 1 ? "" : "s"} in cart
              </span>
              <span className="stat-value text-base font-semibold">
                {money(total)}
              </span>
            </button>
            <Button
              size="sm"
              className="shrink-0"
              onClick={generateBill}
              disabled={create.isPending}
            >
              <ReceiptText className="mr-1 h-4 w-4" /> Generate bill
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
