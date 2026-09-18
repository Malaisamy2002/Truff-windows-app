import { useMemo, useState } from "react";
import { HandCoins, MessageCircle, Receipt, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ListDisclosure } from "./ListDisclosure";
import { SectionHeading } from "@/components/app/SectionHeading";
import { NewDueCard } from "@/components/app/NewDueCard";
import {
  CustomerDetailDialog,
  CustomerDetailContent,
} from "./CustomerDetailDialog";
import { formatDMY, money, whatsappUrl } from "@/lib/biz";
import { openExternal } from "@/lib/desktop";
import { matchesCustomer, useBills, useCustomers } from "@/lib/data";
import { customerOutstanding } from "@/lib/dues";
import { sumRupees } from "@/lib/money";
import { useTurfBookings } from "@/lib/ops";
import { tabKey, useTabEntries, useTabSummaries } from "@/lib/tabs";
import { useSettleCustomer } from "@/lib/customer-actions";
import { compareBy, useSortState, type SortOption } from "@/lib/sort";
import { SortMenu } from "./SortMenu";
import {
  LayoutSection,
  LayoutSections,
  LayoutPart,
  LayoutParts,
} from "./LayoutSection";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

type OutstandingSortField = "amount" | "name" | "oldest";

const OUTSTANDING_SORT_OPTIONS: SortOption<OutstandingSortField>[] = [
  { value: "amount", label: "Amount owed", defaultDir: "desc" },
  { value: "name", label: "Name (A–Z)", defaultDir: "asc" },
  { value: "oldest", label: "Oldest due first", defaultDir: "asc" },
];

type OutstandingRow = {
  key: string;
  name: string;
  phone: string | null;
  total: number;
  itemCount: number;
  oldest: string | null;
};

/** "8 days" style age of the oldest still-open item, for the summary line. */
function ageLabel(iso: string) {
  const then = new Date(`${iso}T00:00:00`).getTime();
  const now = new Date(
    `${new Date().toISOString().slice(0, 10)}T00:00:00`,
  ).getTime();
  const days = Math.max(0, Math.round((now - then) / 86_400_000));
  if (days === 0) return "today";
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Outstanding: the single screen for every rupee a customer still owes,
 * whatever it came from — a turf booking balance, a bill balance, or the
 * running tab. Superseded `DuesTab`, which only ever showed customers with a
 * tab entry; a customer who only had an unpaid booking or bill never
 * appeared there at all. See dues.ts for the underlying "what's owed" rules.
 */
export function OutstandingTab() {
  const { data: customers = [] } = useCustomers();
  const { data: bills = [] } = useBills();
  const { data: bookings = [] } = useTurfBookings();
  const { data: tabEntries = [] } = useTabEntries();
  const tabSummaries = useTabSummaries();
  const [q, setQ] = useState("");
  const [openCustomer, setOpenCustomer] = useState<{
    name: string;
    phone: string | null;
  } | null>(null);
  const sort = useSortState<OutstandingSortField>(
    "outstanding",
    OUTSTANDING_SORT_OPTIONS,
    {
      field: "amount",
      dir: "desc",
    },
  );
  const { settleAll, isPending: settlingAll } = useSettleCustomer();

  const rows = useMemo(() => {
    // One identity per customer_key: every saved customer, PLUS any walk-in
    // who only exists as a running tab (never saved as a contact) — the same
    // coverage the old open-tabs list had, now widened to booking/bill dues.
    const identities = new Map<
      string,
      { name: string; phone: string | null }
    >();
    for (const c of customers) {
      identities.set(tabKey(c.name, c.phone ?? null), {
        name: c.name,
        phone: c.phone ?? null,
      });
    }
    for (const [key, summary] of tabSummaries) {
      if (identities.has(key)) continue;
      const name = summary.tab?.customer_name;
      if (!name) continue;
      identities.set(key, { name, phone: summary.tab?.phone ?? null });
    }

    const list: OutstandingRow[] = [];
    for (const [key, who] of identities) {
      const myEntries = tabEntries.filter((e) => e.customer_key === key);
      const dues = customerOutstanding(who, {
        bills,
        bookings,
        tabEntries: myEntries,
        tabBalance: tabSummaries.get(key)?.balance ?? 0,
        match: (n, p) => tabKey(n, p) === key,
      });
      if (dues.total <= 0) continue;
      const oldest = dues.lines.reduce<string | null>((min, l) => {
        if (!l.date) return min;
        return !min || l.date < min ? l.date : min;
      }, null);
      list.push({
        key,
        name: who.name,
        phone: who.phone,
        total: dues.total,
        itemCount: dues.lines.length,
        oldest,
      });
    }
    return list;
  }, [customers, bills, bookings, tabEntries, tabSummaries]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = term
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(term) ||
            (r.phone ?? "").includes(term.replace(/\D/g, "") || term),
        )
      : rows;
    return [...base].sort((a, b) => {
      switch (sort.field) {
        case "name":
          return compareBy(
            a.name.toLowerCase(),
            b.name.toLowerCase(),
            sort.dir,
          );
        case "oldest":
          return compareBy(a.oldest ?? "", b.oldest ?? "", sort.dir);
        case "amount":
        default:
          return compareBy(a.total, b.total, sort.dir);
      }
    });
  }, [rows, q, sort.field, sort.dir]);

  const totalOwed = sumRupees(rows.map((r) => r.total));
  const isMobile = useIsMobile();

  /** Settling from the row menu needs this customer's own bookings/bills/tab
   * entries — `rows` only carries the aggregate total, not the underlying
   * records — so re-derive them the same way `customerOutstanding()` above
   * already does, then hand off to the one shared settle-all mutation. */
  const settleRow = (r: OutstandingRow) => {
    const identity = { name: r.name, phone: r.phone };
    const myBookings = bookings.filter(
      (b) =>
        matchesCustomer(identity, b.customer_name, b.phone) &&
        b.status !== "Cancelled",
    );
    const myBills = bills.filter((b) =>
      matchesCustomer(identity, b.customer_name, b.customer_phone),
    );
    const myEntries = tabEntries.filter((e) => e.customer_key === r.key);
    settleAll({
      name: r.name,
      phone: r.phone,
      myBookings,
      myBills,
      myEntries,
      tabBalance: tabSummaries.get(r.key)?.balance ?? 0,
    });
  };

  const listCard = (
    <Card className="frost">
      <CardContent className="space-y-2 pt-5">
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {rows.length
              ? "No matches."
              : "Nothing outstanding — everyone's settled up."}
          </p>
        ) : (
          filtered.map((r) => {
            const row = (
              <button
                type="button"
                className={cn(
                  "frost-soft lift flex w-full items-center justify-between gap-3 rounded-2xl border p-3.5 text-left",
                  !isMobile &&
                    openCustomer?.name === r.name &&
                    openCustomer?.phone === r.phone
                    ? "border-primary/50 ring-1 ring-primary/30"
                    : undefined,
                )}
                onClick={() =>
                  setOpenCustomer({ name: r.name, phone: r.phone })
                }
              >
                <div className="min-w-0">
                  <p className="truncate font-medium underline decoration-dotted underline-offset-2">
                    {r.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.phone ? `${r.phone} · ` : ""}
                    {r.itemCount} item{r.itemCount === 1 ? "" : "s"}
                    {r.oldest ? ` · oldest ${ageLabel(r.oldest)}` : ""}
                    {r.oldest ? ` (${formatDMY(r.oldest)})` : ""}
                  </p>
                </div>
                <Badge variant="destructive" className="shrink-0">
                  {money(r.total)}
                </Badge>
              </button>
            );

            // Right-click is desktop-only, same as Bills/Bookings — mobile
            // keeps exactly the plain row it already had.
            if (isMobile) return <div key={r.key}>{row}</div>;
            return (
              <ContextMenu key={r.key}>
                <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={() =>
                      setOpenCustomer({ name: r.name, phone: r.phone })
                    }
                  >
                    Open
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    disabled={settlingAll}
                    onSelect={() => settleRow(r)}
                  >
                    <HandCoins className="size-4" /> Settle all {money(r.total)}
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={!r.phone}
                    onSelect={() =>
                      // window.open() is unreliable inside the Tauri
                      // desktop webview (see openExternal's doc comment in
                      // desktop.ts) — route through the same helper every
                      // other WhatsApp button in the app already uses.
                      void openExternal(
                        whatsappUrl(
                          `Hi ${r.name}, your pending balance is ${money(r.total)}. Thank you!`,
                          r.phone,
                        ),
                      )
                    }
                  >
                    <MessageCircle className="size-4" /> Send WhatsApp reminder
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="BILLS & MONEY"
        title="Outstanding"
        icon={HandCoins}
      />

      {/* Narrow windows: tapping a row pops the existing detail dialog, same
          as before this pass. md+ windows: the row list stays in the left
          column and the same detail content renders inline in a persistent
          right pane instead of a modal — see `sticky-pane` below. */}
      {isMobile && (
        <CustomerDetailDialog
          name={openCustomer?.name ?? null}
          phone={openCustomer?.phone ?? null}
          onOpenChange={(o) => !o && setOpenCustomer(null)}
        />
      )}

      <LayoutSections tabId="dues" className="space-y-6">
        <LayoutSection id="dues.summary">
          <LayoutParts
            sectionId="dues.summary"
            className="grid grid-cols-2 gap-2"
          >
            <LayoutPart
              id="dues.summary.count"
              className="frost-well rounded-2xl border p-3.5 text-center"
            >
              <p className="micro-label whitespace-nowrap">Customers owing</p>
              <p className="stat-value mt-1 text-lg">{rows.length}</p>
            </LayoutPart>
            <LayoutPart
              id="dues.summary.total"
              className="frost-well rounded-2xl border border-primary/30 p-3.5 text-center"
            >
              <p className="micro-label whitespace-nowrap">Total outstanding</p>
              <p className="stat-value mt-1 text-lg text-destructive">
                {money(totalOwed)}
              </p>
            </LayoutPart>
          </LayoutParts>
        </LayoutSection>

        <LayoutSection id="dues.new-due">
          <section className="space-y-3">
            <SectionHeading eyebrow="LOG" title="New due" icon={Receipt} />
            <NewDueCard />
          </section>
        </LayoutSection>

        <LayoutSection id="dues.open-tabs">
          <section className="space-y-3">
            <LayoutParts sectionId="dues.open-tabs" className="space-y-3">
              <LayoutPart id="dues.open-tabs.toolbar" className="space-y-3">
                <SectionHeading
                  eyebrow="COLLECT"
                  title="Outstanding balances"
                  icon={HandCoins}
                  action={
                    <SortMenu
                      options={OUTSTANDING_SORT_OPTIONS}
                      field={sort.field}
                      dir={sort.dir}
                      onFieldChange={sort.setField}
                      onToggleDir={sort.toggleDir}
                    />
                  }
                />
                <Card className="frost">
                  <CardContent className="pt-5">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        placeholder="Search name or phone"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        data-shortcut="search"
                      />
                    </div>
                  </CardContent>
                </Card>
              </LayoutPart>
              <LayoutPart id="dues.open-tabs.list">
                {isMobile ? (
                  <ListDisclosure
                    storageKey="dues.open-tabs"
                    label="Outstanding"
                    count={filtered.length}
                  >
                    {listCard}
                  </ListDisclosure>
                ) : (
                  <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start gap-4">
                    <div className="min-w-0 space-y-3">
                      <p className="micro-label px-1">
                        Outstanding{" "}
                        <span className="text-muted-foreground">
                          ({filtered.length})
                        </span>
                      </p>
                      {listCard}
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
                            <HandCoins className="size-6 opacity-50" />
                            <p>
                              Select a customer to see the full breakdown and
                              collect a payment.
                            </p>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </div>
                )}
              </LayoutPart>
            </LayoutParts>
          </section>
        </LayoutSection>
      </LayoutSections>
    </div>
  );
}
