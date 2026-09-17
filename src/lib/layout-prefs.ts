import { useCallback, useSyncExternalStore } from "react";
import {
  SURFACE_REGISTRY,
  partDef,
  partsForSection,
  type PartDef,
} from "./layout-parts";

export {
  SURFACE_REGISTRY,
  partLabel,
  partKind,
  partsForSection,
  surfaceDef,
} from "./layout-parts";
export type { PartDef, PartKind, SurfaceDef } from "./layout-parts";

/**
 * Layout & arrangement preferences.
 *
 * Lets the owner hide/reorder top-level tabs and the sections inside each tab,
 * pick a visual density, and save the whole arrangement as a named preset.
 *
 * Local-first, same conventions as `ui-prefs.ts` / `settings.ts`:
 * `localStorage` under the `ks:` prefix, validated on read so a stale stored
 * shape can never crash the app.
 */

export type PartState = {
  /** e.g. "turf.new-booking.advance" */
  id: string;
  visible: boolean;
  order: number;
};

export type SectionState = {
  /** e.g. "home.cash-drawer", "settings.turf-rates" */
  id: string;
  visible: boolean;
  order: number;
  /** Level-3 blocks inside the card. Empty when the card has no registry parts. */
  parts: PartState[];
};

export type SurfaceState = {
  /** e.g. "surface.customer-detail" */
  surfaceId: string;
  parts: PartState[];
};

export type TabLayout = {
  tabId: string;
  /** "settings" is coerced to true at read-time regardless of what's stored. */
  visible: boolean;
  order: number;
  sections: SectionState[];
};

export type Density = "comfortable" | "compact";

export type LayoutPreferences = {
  tabs: TabLayout[];
  density: Density;
  /** Pop-up windows, arranged the same way as section parts. */
  surfaces: SurfaceState[];
};

export type LayoutPreset = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  layout: LayoutPreferences;
};

const ACTIVE_KEY = "ks:layout-active";
const PRESETS_KEY = "ks:layout-presets";
const APPLIED_KEY = "ks:layout-applied-preset";
const SETTINGS_ORDER_VERSION_KEY = "ks:settings-order-version";
/** v7: added the "home.operational-alerts" section (next booking / low
 *  stock / backup overdue) right after Quick actions. v6: regrouped Home
 *  into Today / Quick actions / Operational alerts / Secondary zones and
 *  added `home.quick-actions`. */
const SETTINGS_ORDER_VERSION = "8";
/** Bump when the shipped *top-level* tab order changes (see `migrateNavOrder`).
 *  v3: added the "customers" tab (promoted out of Settings' customer
 *  directory) right after Invoices. v2: Outstanding moved up next to
 *  Home/Bookings/Sell. */
const NAV_ORDER_VERSION_KEY = "ks:nav-order-version";
const NAV_ORDER_VERSION = "3";

/** The tab that can never be hidden — it holds this very customization UI. */
export const LOCKED_TAB_ID = "settings";
/** The Settings section that can never be hidden, for the same reason. */
export const LOCKED_SECTION_ID = "settings.layout";

/* ------------------------------------------------------------------ */
/* Registry: the single source of truth for what exists in the code.   */
/* ------------------------------------------------------------------ */

/** Purely presentational hint used by the layout preview glyphs. */
export type SectionKind =
  "stat" | "chart" | "list" | "form" | "table" | "panel";

export type SectionDef = {
  id: string;
  label: string;
  /** Default visibility on a fresh install. */
  defaultVisible?: boolean;
  /** Cannot be hidden (Layout & arrangement itself). */
  locked?: boolean;
  /** Shape hint for the preview only — never persisted. */
  kind?: SectionKind;
};

export type TabDef = {
  tabId: string;
  label: string;
  sections: SectionDef[];
  locked?: boolean;
};

/**
 * Section-id naming: `<tabId>.<kebab-name>` where `<tabId>` matches the tab
 * ids already used by `TABS` in `src/routes/index.tsx` ("home", "money", …),
 * and the suffix describes the block's content rather than its heading text,
 * so renaming a heading never invalidates a stored preference.
 *
 * Shipped tab order.
 *
 * Reordered so the four highest-frequency daily tasks — Home, Bookings
 * (Turf), Sell (Snacks) and Outstanding — are guaranteed to land inside the
 * Android bottom nav's first four slots (see `primaryMobileTabs` in
 * `routes/index.tsx`) by default, instead of Outstanding falling into the
 * "More" sheet. Labels renamed to match the task-first nav: "Turf" →
 * "Bookings", "Snacks" → "Sell", "Bills" → "Invoices", "Money" → "Expenses".
 * Section ids are unchanged, so this never invalidates a stored per-section
 * preference. See also `migrateNavOrder` below, which re-seeds the top-level
 * order once for installs that already have a stored layout.
 *
 * The "home" tab's own sections are further regrouped into four zones, top
 * to bottom: Today (today-numbers) → Quick actions (new) → Operational
 * alerts (new operational-alerts, dues-focus, collect-now, report-ready,
 * insights) → Secondary (cash-drawer, month-compare, turf-utilization,
 * trend-14d, profit-trend). `home.quick-actions` and
 * `home.operational-alerts` are new sections — see their `SECTION_PARTS`
 * entries in `layout-parts.ts` and their render in `DashboardTab.tsx`
 * (`QuickActionsCard.tsx` / `OperationalAlertsCard.tsx`).
 */
export const LAYOUT_REGISTRY: TabDef[] = [
  {
    tabId: "home",
    label: "Home",
    sections: [
      {
        id: "home.today-numbers",
        label: "Today's headline numbers",
        kind: "stat",
      },
      { id: "home.quick-actions", label: "Quick actions", kind: "list" },
      {
        id: "home.operational-alerts",
        label: "Operational alerts",
        kind: "list",
      },
      { id: "home.dues-focus", label: "Money owed to me", kind: "stat" },
      { id: "home.collect-now", label: "Collect now", kind: "list" },
      {
        id: "home.report-ready",
        label: "Monthly statement banner",
        kind: "panel",
      },
      { id: "home.insights", label: "Insights", kind: "list" },
      { id: "home.cash-drawer", label: "Cash in drawer today", kind: "stat" },
      {
        id: "home.month-compare",
        label: "This month vs last month",
        kind: "stat",
      },
      { id: "home.turf-utilization", label: "Turf slot usage", kind: "chart" },
      {
        id: "home.trend-14d",
        label: "Collected vs expenses · 14 days",
        kind: "chart",
      },
      {
        id: "home.profit-trend",
        label: "Profit trend · 6 months",
        kind: "chart",
      },
    ],
  },
  {
    tabId: "turf",
    label: "Bookings",
    sections: [
      { id: "turf.new-booking", label: "New turf booking", kind: "form" },
      { id: "turf.calendar", label: "Booking calendar", kind: "table" },
      { id: "turf.pending-dues", label: "Pending dues", kind: "list" },
      { id: "turf.bookings", label: "Bookings history", kind: "list" },
    ],
  },
  {
    tabId: "snacks",
    label: "Sell",
    sections: [
      { id: "snacks.new-bill", label: "Generate snack bill", kind: "form" },
      { id: "snacks.catalogue", label: "Add snacks", kind: "form" },
      { id: "snacks.stock", label: "Snack stock", kind: "table" },
      { id: "snacks.popular", label: "Popular snacks", kind: "chart" },
      { id: "snacks.sales", label: "Snack sales", kind: "list" },
    ],
  },
  {
    tabId: "dues",
    label: "Outstanding",
    sections: [
      { id: "dues.summary", label: "Outstanding summary", kind: "stat" },
      { id: "dues.new-due", label: "New due", kind: "form" },
      { id: "dues.open-tabs", label: "Outstanding balances", kind: "list" },
    ],
  },
  {
    tabId: "bills",
    label: "Invoices",
    sections: [
      { id: "bills.today-summary", label: "Today's summary", kind: "stat" },
      { id: "bills.search-filter", label: "Search & filter", kind: "form" },
      { id: "bills.ledger", label: "Pending by customer", kind: "table" },
      { id: "bills.list", label: "All bills", kind: "list" },
    ],
  },
  {
    tabId: "customers",
    label: "Customers",
    sections: [
      { id: "customers.directory", label: "Customer directory", kind: "list" },
    ],
  },
  {
    tabId: "money",
    label: "Expenses",
    sections: [
      {
        id: "money.month-summary",
        label: "Money in vs money out",
        kind: "stat",
      },
      { id: "money.budget", label: "Monthly budget", kind: "panel" },
      { id: "money.add-expense", label: "Add expense", kind: "form" },
      { id: "money.recurring", label: "Recurring expenses", kind: "list" },
      { id: "money.by-category", label: "By category", kind: "chart" },
      { id: "money.recent", label: "Recent expenses", kind: "list" },
    ],
  },
  {
    tabId: "reports",
    label: "Reports",
    sections: [
      {
        id: "reports.month-picker",
        label: "Month picker & export",
        kind: "form",
      },
      { id: "reports.hero-kpis", label: "Headline figures", kind: "stat" },
      {
        id: "reports.supporting-kpis",
        label: "Supporting figures",
        kind: "stat",
      },
      {
        id: "reports.payment-split",
        label: "Cash vs UPI split",
        kind: "stat",
      },
      { id: "reports.tax", label: "GST / tax", kind: "table" },
      { id: "reports.insight-kpis", label: "Insight figures", kind: "stat" },
      {
        id: "reports.comparison",
        label: "Month vs previous month",
        kind: "table",
      },
      {
        id: "reports.pnl-table",
        label: "Profit & loss by month",
        kind: "table",
      },
      {
        id: "reports.profit-mix",
        label: "Where the profit came from",
        kind: "chart",
      },
      { id: "reports.turf-usage", label: "Turf usage detail", kind: "chart" },
      { id: "reports.top-customers", label: "Best customers", kind: "list" },
      { id: "reports.item-insights", label: "Best & slow items", kind: "list" },
      { id: "reports.item-sales", label: "Item-wise sales", kind: "table" },
      {
        id: "reports.turf-dues",
        label: "Outstanding dues & ageing",
        kind: "list",
      },
      {
        id: "reports.revenue-by-source",
        label: "Revenue by source",
        kind: "chart",
      },
      {
        id: "reports.expense-trend",
        label: "Expenses · last 6 months",
        kind: "chart",
      },
      {
        id: "reports.snack-share",
        label: "Snack revenue share",
        kind: "chart",
      },
    ],
  },
  {
    tabId: "settings",
    label: "Settings",
    locked: true,
    sections: [
      {
        id: "settings.telegram",
        label: "Cloud backup (Telegram)",
        kind: "panel",
      },
      { id: "settings.backup", label: "Backup & restore", kind: "panel" },
      { id: "settings.turf-rates", label: "Turf rates", kind: "form" },
      { id: "settings.snack-items", label: "Snack items", kind: "table" },
      { id: "settings.billing", label: "Billing & tax", kind: "form" },
      { id: "settings.print", label: "Printer & receipt format", kind: "form" },
      { id: "settings.whatsapp", label: "WhatsApp summary", kind: "panel" },
      { id: "settings.snack-combos", label: "Snack combos", kind: "table" },
      {
        id: "settings.invoice-branding",
        label: "Invoice branding",
        kind: "form",
      },
      { id: "settings.monthly-report", label: "Monthly report", kind: "panel" },
      { id: "settings.theme", label: "Appearance & theme", kind: "panel" },
      {
        id: "settings.layout",
        label: "Layout & arrangement",
        locked: true,
        kind: "panel",
      },
      { id: "settings.archive", label: "Year archive", kind: "panel" },
      { id: "settings.loadtest", label: "Load test", kind: "panel" },
      { id: "settings.danger-zone", label: "Clear all data", kind: "panel" },
    ],
  },
];

export function sectionLabel(id: string): string {
  for (const t of LAYOUT_REGISTRY) {
    const s = t.sections.find((x) => x.id === id);
    if (s) return s.label;
  }
  return id;
}

/** Shape hint for the layout preview. Defaults to "panel" for unknown ids. */
export function sectionKind(id: string): SectionKind {
  for (const t of LAYOUT_REGISTRY) {
    const s = t.sections.find((x) => x.id === id);
    if (s) return s.kind ?? "panel";
  }
  return "panel";
}

export function tabLabel(tabId: string): string {
  return LAYOUT_REGISTRY.find((t) => t.tabId === tabId)?.label ?? tabId;
}

/** The shipped arrangement — "Reset to default" is a true no-op on a fresh install. */
export function getDefaultLayout(): LayoutPreferences {
  return {
    density: "comfortable",
    tabs: LAYOUT_REGISTRY.map((t, ti) => ({
      tabId: t.tabId,
      visible: true,
      order: ti,
      sections: t.sections.map((s, si) => ({
        id: s.id,
        visible: s.defaultVisible ?? true,
        order: si,
        parts: partsForSection(s.id).map((pd, pi) => ({
          id: pd.id,
          visible: pd.defaultVisible ?? true,
          order: pi,
        })),
      })),
    })),
    surfaces: SURFACE_REGISTRY.map((s) => ({
      surfaceId: s.surfaceId,
      parts: s.parts.map((pd, pi) => ({
        id: pd.id,
        visible: pd.defaultVisible ?? true,
        order: pi,
      })),
    })),
  };
}

/** Reconciles stored part states against the shipped part definitions. */
function normalizeParts(defs: PartDef[], stored: unknown): PartState[] {
  const list = Array.isArray(stored) ? (stored as Partial<PartState>[]) : [];
  const parts: PartState[] = defs.map((pd, pi) => {
    const ps = list.find((x) => x && x.id === pd.id);
    const visible = pd.locked
      ? true
      : typeof ps?.visible === "boolean"
        ? ps.visible
        : (pd.defaultVisible ?? true);
    const order =
      typeof ps?.order === "number" && Number.isFinite(ps.order)
        ? ps.order
        : pi + 1000;
    return { id: pd.id, visible, order };
  });
  parts
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((x, i) => {
      x.order = i;
    });
  return parts;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Reconciles a stored layout with what actually exists in the code:
 * unknown tabs/sections/parts are dropped, newly shipped ones are appended as
 * visible, and locked entries are forced visible.
 */
export function normalizeLayout(input: unknown): LayoutPreferences {
  const fallback = getDefaultLayout();
  const raw = (input ?? {}) as Partial<LayoutPreferences>;
  const storedTabs = Array.isArray(raw.tabs) ? raw.tabs : [];
  const storedSurfaces = Array.isArray(raw.surfaces) ? raw.surfaces : [];
  const density: Density =
    raw.density === "compact" ? "compact" : "comfortable";

  const tabs: TabLayout[] = LAYOUT_REGISTRY.map((def, ti) => {
    const stored = storedTabs.find((t) => t && t.tabId === def.tabId);
    const storedSections = Array.isArray(stored?.sections)
      ? stored!.sections
      : [];

    const sections: SectionState[] = def.sections.map((sdef, si) => {
      const ss = storedSections.find((s) => s && s.id === sdef.id);
      const visible = sdef.locked
        ? true
        : typeof ss?.visible === "boolean"
          ? ss.visible
          : (sdef.defaultVisible ?? true);
      const order =
        typeof ss?.order === "number" && Number.isFinite(ss.order)
          ? ss.order
          : si + 1000;
      return {
        id: sdef.id,
        visible,
        order,
        parts: normalizeParts(partsForSection(sdef.id), ss?.parts),
      };
    });
    // Re-pack orders to 0..n-1 so later moves stay simple.
    sections
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((s, i) => {
        s.order = i;
      });

    return {
      tabId: def.tabId,
      visible: def.locked
        ? true
        : typeof stored?.visible === "boolean"
          ? stored.visible
          : true,
      order:
        typeof stored?.order === "number" && Number.isFinite(stored.order)
          ? stored.order
          : ti + 1000,
      sections,
    };
  });

  const surfaces: SurfaceState[] = SURFACE_REGISTRY.map((sdef) => {
    const stored = storedSurfaces.find(
      (s) => s && s.surfaceId === sdef.surfaceId,
    );
    return {
      surfaceId: sdef.surfaceId,
      parts: normalizeParts(sdef.parts, stored?.parts),
    };
  });

  tabs
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((t, i) => {
      t.order = i;
    });

  // Hard guard: Settings can never be hidden.
  const settings = tabs.find((t) => t.tabId === LOCKED_TAB_ID);
  if (settings) settings.visible = true;

  return tabs.length ? { tabs, density, surfaces } : fallback;
}

/** Re-sorts one tab's sections to the shipped order, keeping visibility and
 *  part-level state exactly as the owner left them. */
export function migrateTabOrder(
  layout: LayoutPreferences,
  tabId: string,
): LayoutPreferences {
  const preferred =
    LAYOUT_REGISTRY.find((tab) => tab.tabId === tabId)?.sections ?? [];
  const rank = new Map(preferred.map((section, index) => [section.id, index]));

  return {
    ...layout,
    tabs: layout.tabs.map((tab) =>
      tab.tabId === tabId
        ? {
            ...tab,
            sections: tab.sections
              .slice()
              .sort(
                (a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999),
              )
              .map((section, order) => ({ ...section, order })),
          }
        : tab,
    ),
  };
}

/** Applies a newly shipped Settings priority once while preserving section state. */
export function migrateSettingsOrder(
  layout: LayoutPreferences,
): LayoutPreferences {
  return migrateTabOrder(layout, "settings");
}

/** Tabs whose shipped card order changed and must be re-seeded once. */
const REORDERED_TABS = ["settings", "home", "reports"];

/** One-shot re-seed of the shipped card order across every reordered tab. */
export function migrateCardOrder(layout: LayoutPreferences): LayoutPreferences {
  return REORDERED_TABS.reduce(migrateTabOrder, layout);
}

/**
 * Re-seeds the *top-level* tab order to match `LAYOUT_REGISTRY`, keeping each
 * tab's visibility and every section/part state exactly as the owner left it.
 *
 * This exists so an install that already has a stored layout (from before
 * Outstanding moved up next to Home/Bookings/Sell) picks up the new order
 * too — not just fresh installs computed straight from `getDefaultLayout()`.
 * An owner who deliberately drags tabs into a custom order afterward will
 * have that custom order overwritten once, on the version bump only — the
 * same trade-off already accepted for `migrateCardOrder`/section order.
 */
export function migrateNavOrder(layout: LayoutPreferences): LayoutPreferences {
  const rank = new Map(LAYOUT_REGISTRY.map((def, i) => [def.tabId, i]));
  const tabs = layout.tabs
    .slice()
    .sort((a, b) => (rank.get(a.tabId) ?? 9999) - (rank.get(b.tabId) ?? 9999))
    .map((t, i) => ({ ...t, order: i }));
  return { ...layout, tabs };
}

/* ------------------------------------------------------------------ */
/* Store (localStorage + subscribers)                                  */
/* ------------------------------------------------------------------ */

const listeners = new Set<() => void>();
let cached: LayoutPreferences | null = null;
const serverSnapshot = getDefaultLayout();

function emit() {
  listeners.forEach((l) => l());
}

export function readLayoutPrefs(): LayoutPreferences {
  if (typeof window === "undefined") return serverSnapshot;
  if (cached) return cached;
  let parsed: unknown = null;
  try {
    const rawStr = window.localStorage.getItem(ACTIVE_KEY);
    parsed = rawStr ? JSON.parse(rawStr) : null;
  } catch {
    parsed = null;
  }
  cached = normalizeLayout(parsed);
  try {
    if (
      window.localStorage.getItem(SETTINGS_ORDER_VERSION_KEY) !==
      SETTINGS_ORDER_VERSION
    ) {
      cached = migrateCardOrder(cached);
      window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(cached));
      window.localStorage.setItem(
        SETTINGS_ORDER_VERSION_KEY,
        SETTINGS_ORDER_VERSION,
      );
    }
    if (
      window.localStorage.getItem(NAV_ORDER_VERSION_KEY) !== NAV_ORDER_VERSION
    ) {
      cached = migrateNavOrder(cached);
      window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(cached));
      window.localStorage.setItem(NAV_ORDER_VERSION_KEY, NAV_ORDER_VERSION);
    }
  } catch {
    /* storage unavailable — the new default order still applies this session */
    cached = migrateCardOrder(cached);
    cached = migrateNavOrder(cached);
  }
  return cached;
}

export function writeLayoutPrefs(next: LayoutPreferences) {
  cached = normalizeLayout(next);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(cached));
    } catch {
      /* storage unavailable — in-memory state still works this session */
    }
  }
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useLayoutPrefs() {
  const layout = useSyncExternalStore(
    subscribe,
    readLayoutPrefs,
    () => serverSnapshot,
  );
  const update = useCallback(
    (fn: (prev: LayoutPreferences) => LayoutPreferences) => {
      writeLayoutPrefs(fn(readLayoutPrefs()));
    },
    [],
  );
  return { layout, update };
}

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

export function visibleTabIds(layout: LayoutPreferences): string[] {
  return layout.tabs
    .filter((t) => t.visible)
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((t) => t.tabId);
}

export function orderedSections(
  layout: LayoutPreferences,
  tabId: string,
): SectionState[] {
  const tab = layout.tabs.find((t) => t.tabId === tabId);
  if (!tab) return [];
  return tab.sections.slice().sort((a, b) => a.order - b.order);
}

/** Ordered, visible-only section ids for a tab. Used by `LayoutSections`. */
export function useTabSectionOrder(tabId: string) {
  const { layout } = useLayoutPrefs();
  const ordered = orderedSections(layout, tabId);
  return {
    order: ordered.map((s) => s.id),
    visible: new Set(ordered.filter((s) => s.visible).map((s) => s.id)),
  };
}

export function useDensity(): Density {
  return useLayoutPrefs().layout.density;
}

/* ---- Level 3: parts inside a section, and parts inside a pop-up ---- */

export function orderedParts(
  layout: LayoutPreferences,
  sectionId: string,
): PartState[] {
  for (const t of layout.tabs) {
    const s = t.sections.find((x) => x.id === sectionId);
    if (s) return s.parts.slice().sort((a, b) => a.order - b.order);
  }
  return [];
}

export function orderedSurfaceParts(
  layout: LayoutPreferences,
  surfaceId: string,
): PartState[] {
  const s = layout.surfaces.find((x) => x.surfaceId === surfaceId);
  return s ? s.parts.slice().sort((a, b) => a.order - b.order) : [];
}

/** Ordered, visible-only part ids for a card. Used by `LayoutParts`. */
export function usePartOrder(sectionId: string) {
  const { layout } = useLayoutPrefs();
  const ordered = orderedParts(layout, sectionId);
  return {
    order: ordered.map((x) => x.id),
    visible: new Set(ordered.filter((x) => x.visible).map((x) => x.id)),
    known: ordered.length > 0,
  };
}

/** Ordered, visible-only part ids for a pop-up window. */
export function useSurfacePartOrder(surfaceId: string) {
  const { layout } = useLayoutPrefs();
  const ordered = orderedSurfaceParts(layout, surfaceId);
  return {
    order: ordered.map((x) => x.id),
    visible: new Set(ordered.filter((x) => x.visible).map((x) => x.id)),
    known: ordered.length > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

function reorder<T>(list: T[], from: number, to: number): T[] {
  const copy = list.slice();
  const [item] = copy.splice(from, 1);
  if (!item) return list;
  copy.splice(to, 0, item);
  return copy;
}

export function setTabVisible(
  layout: LayoutPreferences,
  tabId: string,
  visible: boolean,
) {
  if (tabId === LOCKED_TAB_ID) return layout;
  return {
    ...layout,
    tabs: layout.tabs.map((t) => (t.tabId === tabId ? { ...t, visible } : t)),
  };
}

export function moveTab(layout: LayoutPreferences, tabId: string, dir: -1 | 1) {
  const sorted = layout.tabs.slice().sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((t) => t.tabId === tabId);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= sorted.length) return layout;
  const next = reorder(sorted, idx, target).map((t, i) => ({ ...t, order: i }));
  return { ...layout, tabs: next };
}

export function setSectionVisible(
  layout: LayoutPreferences,
  tabId: string,
  sectionId: string,
  visible: boolean,
) {
  if (sectionId === LOCKED_SECTION_ID) return layout;
  return {
    ...layout,
    tabs: layout.tabs.map((t) =>
      t.tabId === tabId
        ? {
            ...t,
            sections: t.sections.map((s) =>
              s.id === sectionId ? { ...s, visible } : s,
            ),
          }
        : t,
    ),
  };
}

export function moveSection(
  layout: LayoutPreferences,
  tabId: string,
  sectionId: string,
  dir: -1 | 1,
) {
  return {
    ...layout,
    tabs: layout.tabs.map((t) => {
      if (t.tabId !== tabId) return t;
      const sorted = t.sections.slice().sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((s) => s.id === sectionId);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= sorted.length) return t;
      return {
        ...t,
        sections: reorder(sorted, idx, target).map((s, i) => ({
          ...s,
          order: i,
        })),
      };
    }),
  };
}

function isPartLocked(partId: string) {
  return partDef(partId)?.locked === true;
}

function mapSectionParts(
  layout: LayoutPreferences,
  sectionId: string,
  fn: (parts: PartState[]) => PartState[],
): LayoutPreferences {
  return {
    ...layout,
    tabs: layout.tabs.map((t) => ({
      ...t,
      sections: t.sections.map((s) =>
        s.id === sectionId ? { ...s, parts: fn(s.parts) } : s,
      ),
    })),
  };
}

function mapSurfaceParts(
  layout: LayoutPreferences,
  surfaceId: string,
  fn: (parts: PartState[]) => PartState[],
): LayoutPreferences {
  return {
    ...layout,
    surfaces: layout.surfaces.map((s) =>
      s.surfaceId === surfaceId ? { ...s, parts: fn(s.parts) } : s,
    ),
  };
}

function movePartIn(
  parts: PartState[],
  partId: string,
  dir: -1 | 1,
): PartState[] {
  const sorted = parts.slice().sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((x) => x.id === partId);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= sorted.length) return parts;
  return reorder(sorted, idx, target).map((x, i) => ({ ...x, order: i }));
}

export function setPartVisible(
  layout: LayoutPreferences,
  sectionId: string,
  partId: string,
  visible: boolean,
) {
  if (isPartLocked(partId)) return layout;
  return mapSectionParts(layout, sectionId, (parts) =>
    parts.map((x) => (x.id === partId ? { ...x, visible } : x)),
  );
}

export function movePart(
  layout: LayoutPreferences,
  sectionId: string,
  partId: string,
  dir: -1 | 1,
) {
  return mapSectionParts(layout, sectionId, (parts) =>
    movePartIn(parts, partId, dir),
  );
}

export function setSurfacePartVisible(
  layout: LayoutPreferences,
  surfaceId: string,
  partId: string,
  visible: boolean,
) {
  if (isPartLocked(partId)) return layout;
  return mapSurfaceParts(layout, surfaceId, (parts) =>
    parts.map((x) => (x.id === partId ? { ...x, visible } : x)),
  );
}

export function moveSurfacePart(
  layout: LayoutPreferences,
  surfaceId: string,
  partId: string,
  dir: -1 | 1,
) {
  return mapSurfaceParts(layout, surfaceId, (parts) =>
    movePartIn(parts, partId, dir),
  );
}

export function setDensity(
  layout: LayoutPreferences,
  density: Density,
): LayoutPreferences {
  return { ...layout, density };
}

export function resetLayoutToDefault() {
  writeLayoutPrefs(getDefaultLayout());
  setAppliedPresetId(null);
}

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

const presetListeners = new Set<() => void>();
let presetCache: LayoutPreset[] | null = null;
const emptyPresets: LayoutPreset[] = [];

function emitPresets() {
  presetListeners.forEach((l) => l());
}

function normalizePreset(input: unknown): LayoutPreset | null {
  const p = input as Partial<LayoutPreset> | null;
  if (!p || typeof p.id !== "string" || typeof p.name !== "string") return null;
  return {
    id: p.id,
    name: p.name,
    createdAt:
      typeof p.createdAt === "string" ? p.createdAt : new Date().toISOString(),
    updatedAt:
      typeof p.updatedAt === "string" ? p.updatedAt : new Date().toISOString(),
    layout: normalizeLayout(p.layout),
  };
}

export function listPresets(): LayoutPreset[] {
  if (typeof window === "undefined") return emptyPresets;
  if (presetCache) return presetCache;
  try {
    const raw = window.localStorage.getItem(PRESETS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    presetCache = Array.isArray(parsed)
      ? parsed.map(normalizePreset).filter((p): p is LayoutPreset => p !== null)
      : [];
  } catch {
    presetCache = [];
  }
  return presetCache;
}

function writePresets(list: LayoutPreset[]) {
  presetCache = list;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  }
  emitPresets();
}

export function getAppliedPresetId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(APPLIED_KEY);
  } catch {
    return null;
  }
}

export function setAppliedPresetId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(APPLIED_KEY, id);
    else window.localStorage.removeItem(APPLIED_KEY);
  } catch {
    /* ignore */
  }
  emitPresets();
}

function newId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function presetNameTaken(name: string, exceptId?: string) {
  const n = name.trim().toLowerCase();
  return listPresets().some(
    (p) => p.id !== exceptId && p.name.trim().toLowerCase() === n,
  );
}

export function savePreset(
  name: string,
  layout: LayoutPreferences,
): LayoutPreset {
  const now = new Date().toISOString();
  const preset: LayoutPreset = {
    id: newId(),
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    layout: normalizeLayout(layout),
  };
  writePresets([...listPresets(), preset]);
  setAppliedPresetId(preset.id);
  return preset;
}

export function updatePreset(id: string, layout: LayoutPreferences) {
  writePresets(
    listPresets().map((p) =>
      p.id === id
        ? {
            ...p,
            layout: normalizeLayout(layout),
            updatedAt: new Date().toISOString(),
          }
        : p,
    ),
  );
  setAppliedPresetId(id);
}

export function applyPreset(id: string) {
  const preset = listPresets().find((p) => p.id === id);
  if (!preset) return;
  writeLayoutPrefs(preset.layout);
  setAppliedPresetId(id);
}

export function renamePreset(id: string, name: string) {
  writePresets(
    listPresets().map((p) =>
      p.id === id
        ? { ...p, name: name.trim(), updatedAt: new Date().toISOString() }
        : p,
    ),
  );
}

export function duplicatePreset(id: string) {
  const preset = listPresets().find((p) => p.id === id);
  if (!preset) return;
  let name = `${preset.name} copy`;
  let i = 2;
  while (presetNameTaken(name)) name = `${preset.name} copy ${i++}`;
  const now = new Date().toISOString();
  writePresets([
    ...listPresets(),
    {
      id: newId(),
      name,
      createdAt: now,
      updatedAt: now,
      layout: preset.layout,
    },
  ]);
}

/** Deleting the applied preset keeps the current arrangement, marked "Custom". */
export function deletePreset(id: string) {
  writePresets(listPresets().filter((p) => p.id !== id));
  if (getAppliedPresetId() === id) setAppliedPresetId(null);
}

function subscribePresets(cb: () => void) {
  presetListeners.add(cb);
  return () => presetListeners.delete(cb);
}

export function usePresets() {
  const presets = useSyncExternalStore(
    subscribePresets,
    listPresets,
    () => emptyPresets,
  );
  const appliedId = useSyncExternalStore(
    subscribePresets,
    getAppliedPresetId,
    () => null as string | null,
  );
  return { presets, appliedId };
}

/* ------------------------------------------------------------------ */
/* Export / import                                                     */
/* ------------------------------------------------------------------ */

export type LayoutBackup = {
  kind: "ks-layout-backup";
  version: 1;
  active: LayoutPreferences;
  presets: LayoutPreset[];
};

export function exportLayoutJson(): string {
  const payload: LayoutBackup = {
    kind: "ks-layout-backup",
    version: 1,
    active: readLayoutPrefs(),
    presets: listPresets(),
  };
  return JSON.stringify(payload, null, 2);
}

/** Returns true when the file was a valid layout backup and was applied. */
export function importLayoutJson(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  const data = parsed as Partial<LayoutBackup> | null;
  if (!data || data.kind !== "ks-layout-backup" || !data.active) return false;
  const active = normalizeLayout(data.active);
  const presets = Array.isArray(data.presets)
    ? data.presets
        .map(normalizePreset)
        .filter((p): p is LayoutPreset => p !== null)
    : [];
  writePresets(presets);
  writeLayoutPrefs(active);
  setAppliedPresetId(null);
  return true;
}
