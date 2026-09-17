import { lazy, Suspense, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Cookie,
  FileText,
  Wallet,
  BookOpen,
  BarChart3,
  Trophy,
  Settings,
  LayoutDashboard,
  Search,
  Users,
} from "lucide-react";
import { ArchiveYearDialog } from "@/components/app/ArchiveYearDialog";
import { DesktopFirstRunNotice } from "@/components/app/DesktopFirstRunNotice";
import { YearSwitcher } from "@/components/app/YearSwitcher";
import { ScrollEdgeButton } from "@/components/app/ScrollEdgeButton";
import { AppStatusStrip } from "@/components/app/AppStatusStrip";
import {
  DataEntryShortcuts,
  ShortcutsHintButton,
} from "@/components/app/DataEntryShortcuts";
import {
  CommandPalette,
  useCommandPaletteShortcut,
  MOD_LABEL,
} from "@/components/app/CommandPalette";
import { BUSINESS_NAME } from "@/lib/biz";
import { usePrintSettings } from "@/lib/print";
import { usePersistedState } from "@/lib/ui-prefs";
import { useLayoutPrefs, visibleTabIds } from "@/lib/layout-prefs";

import { backupReminderDue, readAppSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

const TITLE = "Turf Bookings & Sales — Booking, Billing & Reports";
const DESC =
  "Calculate turf bookings, generate numbered invoices with PDF receipts, track expenses and profit, and share bills on WhatsApp.";

// Keep startup focused on the selected tab. Reports, Settings and exports
// pull in chart/PDF/Excel dependencies that do not belong in every launch.
const DashboardTab = lazy(() =>
  import("@/components/app/DashboardTab").then(({ DashboardTab }) => ({
    default: DashboardTab,
  })),
);
const TurfTab = lazy(() =>
  import("@/components/app/TurfTab").then(({ TurfTab }) => ({
    default: TurfTab,
  })),
);
const SnacksTab = lazy(() =>
  import("@/components/app/SnacksTab").then(({ SnacksTab }) => ({
    default: SnacksTab,
  })),
);
const BillsTab = lazy(() =>
  import("@/components/app/BillsTab").then(({ BillsTab }) => ({
    default: BillsTab,
  })),
);
const ExpensesTab = lazy(() =>
  import("@/components/app/ExpensesTab").then(({ ExpensesTab }) => ({
    default: ExpensesTab,
  })),
);
const OutstandingTab = lazy(() =>
  import("@/components/app/OutstandingTab").then(({ OutstandingTab }) => ({
    default: OutstandingTab,
  })),
);
const CustomersTab = lazy(() =>
  import("@/components/app/CustomersTab").then(({ CustomersTab }) => ({
    default: CustomersTab,
  })),
);
const ReportsTab = lazy(() =>
  import("@/components/app/ReportsTab").then(({ ReportsTab }) => ({
    default: ReportsTab,
  })),
);
const SettingsTab = lazy(() =>
  import("@/components/app/SettingsTab").then(({ SettingsTab }) => ({
    default: SettingsTab,
  })),
);

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

// Labels renamed to match the task-first nav used across both apps:
// "Turf" → "Bookings", "Snacks" → "Sell", "Bills" → "Invoices",
// "Money" → "Expenses". Tab ids are unchanged. Order here only matters for
// the narrow-window bottom-nav fallback; the sidebar below groups tabs by
// `NAV_GROUPS` instead, independent of this array's order.
const TABS = [
  { id: "home", label: "Home", icon: LayoutDashboard },
  { id: "turf", label: "Bookings", icon: Trophy },
  { id: "snacks", label: "Sell", icon: Cookie },
  { id: "dues", label: "Outstanding", icon: BookOpen },
  { id: "bills", label: "Invoices", icon: FileText },
  { id: "customers", label: "Customers", icon: Users },
  { id: "money", label: "Expenses", icon: Wallet },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TAB_IDS = TABS.map((t) => t.id);

/**
 * Desktop sidebar grouping (replaces the flat 8-item top nav). Grouping is
 * fixed — it's the shape recommended for the Windows nav restructure — while
 * the order and visibility *within* a group still follow the owner's
 * Settings → Layout & arrangement preferences.
 */
const NAV_GROUPS: { title: string; ids: TabId[] }[] = [
  { title: "Operations", ids: ["home", "turf", "snacks", "dues", "money"] },
  { title: "Records", ids: ["bills", "customers", "reports"] },
  { title: "Administration", ids: ["settings"] },
];

function Index() {
  const [tab, setTab] = usePersistedState<TabId>("active-tab", "home", (v) =>
    (TAB_IDS as readonly string[]).includes(v),
  );
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useCommandPaletteShortcut(() => setPaletteOpen(true));

  // Settings → "Arrange this app" leaves Settings and lands on Home, where the
  // real cards are already framed by arrange mode.
  useEffect(() => {
    const onStart = () => setTab("home");
    window.addEventListener("arrange:start", onStart);
    return () => window.removeEventListener("arrange:start", onStart);
  }, [setTab]);

  // Home → "Quick actions" jumps straight to another tab (e.g. "New booking"
  // → Bookings) without each button needing its own prop-drilled setter.
  // The Customers tab's "New booking"/"New sale" row actions use the same
  // event, additionally carrying that customer's name/phone so the
  // destination tab can prefill its form — captured here and handed down as
  // `prefillCustomer`, cleared once the destination tab has consumed it so
  // switching away and back doesn't reapply a stale prefill.
  const [prefillCustomer, setPrefillCustomer] = useState<{
    tab: TabId;
    name: string;
    phone: string | null;
  } | null>(null);
  useEffect(() => {
    const onGoto = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          tab?: string;
          customerName?: string;
          customerPhone?: string | null;
        }>
      ).detail;
      const id = detail?.tab;
      if (id && (TAB_IDS as readonly string[]).includes(id)) {
        setTab(id as TabId);
        setPrefillCustomer(
          detail?.customerName
            ? {
                tab: id as TabId,
                name: detail.customerName,
                phone: detail.customerPhone ?? null,
              }
            : null,
        );
      }
    };
    window.addEventListener("nav:goto", onGoto);
    return () => window.removeEventListener("nav:goto", onGoto);
  }, [setTab]);

  const { settings: printSettings } = usePrintSettings();
  const shopTitle = printSettings.shopName.trim() || BUSINESS_NAME;

  // Tab bar follows Settings → Layout & arrangement: hidden tabs disappear and
  // the rest keep the owner's chosen order. Settings itself can never be hidden.
  const { layout } = useLayoutPrefs();
  const visibleIds = visibleTabIds(layout);
  const visibleTabs = visibleIds
    .map((id) => TABS.find((t) => t.id === id))
    .filter((t): t is (typeof TABS)[number] => Boolean(t));
  const shownTabs = visibleTabs.length ? visibleTabs : TABS.slice();
  const activeTab: TabId = shownTabs.some((t) => t.id === tab)
    ? tab
    : ((shownTabs[0]?.id ?? "settings") as TabId);
  const navTabIds = shownTabs.map((t) => t.id);

  // Sidebar sections: each group keeps only the tabs the owner hasn't hidden,
  // in the owner's chosen order (not the fixed order the group ids are
  // listed in above).
  const sidebarGroups = NAV_GROUPS.map((g) => ({
    title: g.title,
    tabs: shownTabs.filter((t) => (g.ids as readonly string[]).includes(t.id)),
  })).filter((g) => g.tabs.length > 0);

  // One-time backup reminder, per the Settings → Backup frequency.
  useEffect(() => {
    const s = readAppSettings();
    if (!backupReminderDue(s)) return;
    const t = window.setTimeout(() => {
      toast.info("Time for a backup", {
        description: `Your ${s.backupReminder} backup is due. Open Settings → Backup & restore to export.`,
        duration: 10000,
      });
    }, 4000);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      className="min-h-screen bg-background pb-24 md:pb-8"
      data-density={layout.density}
    >
      <ArchiveYearDialog />
      <DesktopFirstRunNotice />
      <ScrollEdgeButton />
      <ShortcutsHintButton onClick={() => setShortcutsOpen(true)} />
      <DataEntryShortcuts
        tabIds={navTabIds}
        onGoToTab={(id) => setTab(id as TabId)}
        helpOpen={shortcutsOpen}
        onHelpOpenChange={setShortcutsOpen}
      />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        navTabs={shownTabs}
        onGoToTab={(id) => setTab(id as TabId)}
      />
      <header className="sticky top-0 z-20 border-b border-white/15 brand-gradient pt-[env(safe-area-inset-top)] text-primary-foreground shadow-[0_10px_30px_-20px_oklch(0.4_0.1_250)] backdrop-blur-xl">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 md:flex md:justify-between md:gap-6 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-white/25 bg-white/15 backdrop-blur-md">
              <Trophy className="size-5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold leading-tight tracking-tight md:text-lg">
                {shopTitle}
              </h1>
              <p className="truncate text-[11px] uppercase tracking-[0.08em] opacity-75">
                Booking, billing &amp; business manager
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden items-center gap-2 rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs text-primary-foreground/90 backdrop-blur-md transition-colors hover:bg-white/20 md:flex"
              title={`Search & commands (${MOD_LABEL})`}
            >
              <Search className="size-3.5" />
              <span>Search…</span>
              <kbd className="rounded border border-white/25 bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">
                {MOD_LABEL}
              </kbd>
            </button>
            <YearSwitcher />
          </div>
        </div>
      </header>

      <AppStatusStrip />
      <div className="mx-auto flex w-full max-w-[100rem] items-start md:px-4">
        {/* Persistent left sidebar (desktop). Replaces the old flat 8-item
            top nav with three fixed groups — Operations / Records /
            Administration — so the nav scales past a handful of tabs
            without becoming a wall of pills. Hidden below md; the bottom
            nav further down covers narrow windows instead. */}
        <nav
          aria-label="Main sections"
          className="sticky top-[calc(4.25rem+1.75rem+env(safe-area-inset-top))] hidden h-[calc(100dvh-4.25rem-1.75rem-env(safe-area-inset-top))] w-56 shrink-0 flex-col gap-5 overflow-y-auto border-r px-3 py-5 md:flex"
        >
          {sidebarGroups.map((g) => (
            <div key={g.title} className="flex flex-col gap-1">
              <p className="micro-label px-2 pb-1 text-muted-foreground">
                {g.title}
              </p>
              {g.tabs.map((t) => {
                const Icon = t.icon;
                const active = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all",
                      active
                        ? "bg-primary/10 text-primary shadow-sm"
                        : "text-foreground/80 hover:bg-muted/60",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{t.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <main className="mx-auto w-full min-w-0 max-w-2xl p-4 md:max-w-5xl md:px-8 md:py-8">
          <Suspense
            fallback={
              <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">
                Loading section…
              </div>
            }
          >
            {activeTab === "home" && <DashboardTab />}
            {activeTab === "turf" && (
              <TurfTab
                prefillCustomer={
                  prefillCustomer?.tab === "turf"
                    ? {
                        name: prefillCustomer.name,
                        phone: prefillCustomer.phone,
                      }
                    : null
                }
                onConsumePrefillCustomer={() => setPrefillCustomer(null)}
              />
            )}
            {activeTab === "snacks" && (
              <SnacksTab
                prefillCustomer={
                  prefillCustomer?.tab === "snacks"
                    ? {
                        name: prefillCustomer.name,
                        phone: prefillCustomer.phone,
                      }
                    : null
                }
                onConsumePrefillCustomer={() => setPrefillCustomer(null)}
              />
            )}
            {activeTab === "bills" && <BillsTab />}
            {activeTab === "customers" && <CustomersTab />}
            {activeTab === "money" && <ExpensesTab />}
            {activeTab === "dues" && <OutstandingTab />}
            {activeTab === "reports" && <ReportsTab />}
            {activeTab === "settings" && <SettingsTab />}
          </Suspense>
        </main>
      </div>

      <nav className="frost fixed inset-x-0 bottom-0 z-20 flex overflow-x-auto border-t pb-[env(safe-area-inset-bottom)] md:hidden">
        {shownTabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "relative flex min-w-0 flex-1 flex-col items-center gap-1 whitespace-nowrap py-2.5 text-[11px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-8 place-items-center rounded-full transition-all",
                  active
                    ? "bg-primary/12 shadow-[0_6px_16px_-10px_var(--primary)]"
                    : "",
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
              {t.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
