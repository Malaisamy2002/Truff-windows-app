/**
 * Part-level layout registry.
 *
 * Level 3 of the layout system: the individual rows, fields and buttons that
 * live *inside* a section card, plus the pop-up windows ("surfaces") that are
 * not attached to any tab.
 *
 * Ids are `<tabId>.<section>.<part>` for section parts and
 * `surface.<name>.<part>` for pop-up parts. Ids are persisted, so rename a
 * label freely but never an id.
 */

export type PartKind =
  "field" | "row" | "action" | "summary" | "list" | "chart" | "panel";

export type PartDef = {
  id: string;
  label: string;
  kind?: PartKind;
  /** Required to use the card at all — reorderable, never hideable. */
  locked?: boolean;
  defaultVisible?: boolean;
};

export type SurfaceDef = {
  surfaceId: string;
  label: string;
  parts: PartDef[];
};

const p = (
  id: string,
  label: string,
  kind: PartKind = "field",
  locked = false,
): PartDef => ({
  id,
  label,
  kind,
  locked,
});

/* ------------------------------------------------------------------ */
/* Section parts, keyed by section id                                  */
/* ------------------------------------------------------------------ */

export const SECTION_PARTS: Record<string, PartDef[]> = {
  /* ---------------------------- Turf ---------------------------- */
  "turf.new-booking": [
    p("turf.new-booking.customer", "Customer name & phone", "field", true),
    p("turf.new-booking.slot-picker", "Date & time slots", "panel", true),
    p("turf.new-booking.slot-rate", "Slot rate"),
    p("turf.new-booking.selected-time", "Selected time (auto)", "summary"),
    p("turf.new-booking.turf-amount", "Turf amount (auto)", "summary"),
    p("turf.new-booking.extras", "Discount & notes", "action"),
    p("turf.new-booking.grand-total", "Grand total (auto)", "summary", true),
    p("turf.new-booking.advance", "Advance paid"),
    p("turf.new-booking.balance", "Balance due (auto)", "summary"),
    p("turf.new-booking.payment-mode", "Payment mode"),
    p("turf.new-booking.status", "Status"),
    p("turf.new-booking.repeat", "Repeat weekly"),
    p("turf.new-booking.save", "Save booking button", "action", true),
  ],
  "turf.calendar": [
    p("turf.calendar.controls", "Month controls", "row", true),
    p("turf.calendar.grid", "Calendar grid", "panel", true),
    p("turf.calendar.day-detail", "Selected day bookings", "list"),
  ],
  "turf.pending-dues": [
    p("turf.pending-dues.heading", "Heading & total", "summary"),
    p("turf.pending-dues.list", "Dues list", "list", true),
  ],
  "turf.bookings": [
    p("turf.bookings.heading", "Heading", "summary"),
    p("turf.bookings.toolbar", "Search, sort & export", "row"),
    p("turf.bookings.list", "Bookings list", "list", true),
  ],

  /* --------------------------- Snacks --------------------------- */
  "snacks.new-bill": [
    p("snacks.new-bill.customer", "Customer name & phone", "field", true),
    p(
      "snacks.new-bill.frequent",
      "Repeat last order & usually-orders shortcuts",
      "row",
    ),
    p("snacks.new-bill.date", "Date"),
    p("snacks.new-bill.payment-mode", "Payment mode"),
    p("snacks.new-bill.total", "Bill total (auto)", "summary", true),
    p("snacks.new-bill.link-booking", "Link to turf booking"),
    p("snacks.new-bill.notes", "Notes"),
    p("snacks.new-bill.save", "Generate bill button", "action", true),
  ],
  "snacks.catalogue": [
    p("snacks.catalogue.popular", "Popular this week", "row"),
    p("snacks.catalogue.combos", "Combo deals", "row"),
    p("snacks.catalogue.grid", "Category quick-add grid", "panel"),
    p("snacks.catalogue.picker", "Item, qty & add button", "panel", true),
    p("snacks.catalogue.tip", "Keyboard tip", "summary"),
    p("snacks.catalogue.cart", "Cart lines", "list", true),
  ],

  "snacks.stock": [
    p("snacks.stock.heading", "Heading & low-stock warning", "summary"),
    p("snacks.stock.table", "Stock table", "list", true),
  ],
  "snacks.popular": [
    p("snacks.popular.heading", "Heading", "summary"),
    p("snacks.popular.chart", "Chart", "chart", true),
  ],
  "snacks.sales": [
    p("snacks.sales.toolbar", "Search & sort", "row"),
    p("snacks.sales.list", "Sales list", "list", true),
  ],

  /* ---------------------------- Bills --------------------------- */
  "bills.today-summary": [
    p("bills.today-summary.count", "Bill count", "summary"),
    p("bills.today-summary.billed", "Billed today", "summary"),
    p("bills.today-summary.collected", "Collected today", "summary"),
    p("bills.today-summary.pending", "Pending today", "summary"),
  ],
  "bills.search-filter": [
    p("bills.search-filter.search", "Search box", "field", true),
    p("bills.search-filter.status", "Status filter"),
    p("bills.search-filter.date", "Date range"),
    p("bills.search-filter.sort", "Sort"),
    p("bills.search-filter.export", "Export", "action"),
  ],
  "bills.ledger": [
    p("bills.ledger.heading", "Heading", "summary"),
    p("bills.ledger.table", "Customer ledger", "list", true),
  ],
  "bills.list": [
    p("bills.list.bulk", "Bulk actions bar", "row"),
    p("bills.list.heading", "Heading", "summary"),
    p("bills.list.items", "Bill rows", "list", true),
  ],

  /* ---------------------------- Money --------------------------- */
  "money.month-summary": [
    p("money.month-summary.in", "Money in", "summary"),
    p("money.month-summary.out", "Money out", "summary"),
    p("money.month-summary.net", "Net", "summary"),
  ],
  "money.budget": [
    p("money.budget.amount", "Budget amount", "field", true),
    p("money.budget.progress", "Spend progress", "summary"),
  ],
  "money.add-expense": [
    p("money.add-expense.shortcuts", "Quick-add shortcuts", "row"),
    p("money.add-expense.date", "Date"),
    p("money.add-expense.business", "Business"),
    p("money.add-expense.category", "Category"),
    p("money.add-expense.description", "Description", "field", true),
    p("money.add-expense.amount", "Amount", "field", true),
    p("money.add-expense.notes", "Notes"),
    p("money.add-expense.receipt", "Receipt photo"),
    p("money.add-expense.save", "Add expense button", "action", true),
  ],
  "money.recurring": [
    p("money.recurring.heading", "Heading", "summary"),
    p("money.recurring.form", "New recurring rule form", "panel", true),
    p("money.recurring.list", "Recurring list", "list", true),
  ],
  "money.by-category": [
    p("money.by-category.heading", "Heading", "summary"),
    p("money.by-category.chart", "Chart", "chart", true),
  ],
  "money.recent": [
    p("money.recent.toolbar", "Search & sort", "row"),
    p("money.recent.list", "Expense rows", "list", true),
  ],

  /* ---------------------------- Dues ---------------------------- */
  "dues.summary": [
    p("dues.summary.total", "Total outstanding", "summary"),
    p("dues.summary.count", "Open tabs count", "summary"),
  ],
  "dues.new-due": [
    p("dues.new-due.customer", "Customer name & phone", "field", true),
    p("dues.new-due.business", "Business"),
    p("dues.new-due.amount", "Amount", "field", true),
    p("dues.new-due.date", "Date"),
    p("dues.new-due.reason", "Reason / notes"),
    p("dues.new-due.save", "Add due button", "action", true),
  ],
  "dues.open-tabs": [
    p("dues.open-tabs.toolbar", "Search & sort", "row"),
    p("dues.open-tabs.list", "Open tabs list", "list", true),
  ],

  /* ---------------------------- Home ---------------------------- */
  "home.today-numbers": [
    p("home.today-numbers.heading", "Heading", "summary"),
    p("home.today-numbers.collected", "Collected today", "summary"),
    p("home.today-numbers.pending", "Pending dues", "summary"),
    p("home.today-numbers.supporting", "Supporting tiles", "list"),
  ],
  "home.quick-actions": [
    p("home.quick-actions.heading", "Heading", "summary"),
    p("home.quick-actions.buttons", "Action buttons", "action", true),
  ],
  "home.operational-alerts": [
    p("home.operational-alerts.heading", "Heading", "summary"),
    p("home.operational-alerts.list", "Alert rows", "list", true),
  ],
  "home.month-compare": [
    p("home.month-compare.heading", "Heading", "summary"),
    p("home.month-compare.cards", "Month comparison tiles", "list", true),
  ],
  "home.cash-drawer": [
    p("home.cash-drawer.heading", "Heading", "summary"),
    p("home.cash-drawer.drawer", "Expected cash in drawer", "summary", true),
  ],
  "home.collect-now": [
    p("home.collect-now.heading", "Heading", "summary"),
    p("home.collect-now.list", "Customers to collect from", "list", true),
  ],

  /* --------------------------- Reports -------------------------- */
  "reports.month-picker": [
    p("reports.month-picker.month", "Month picker", "field", true),
    p("reports.month-picker.quick-months", "Quick month chips", "row"),
  ],
  "reports.comparison": [
    p("reports.comparison.toolbar", "Heading & export buttons", "row"),
    p("reports.comparison.tiles", "Comparison tiles", "list", true),
  ],
  "reports.item-sales": [
    p("reports.item-sales.toolbar", "Heading, sort & export", "row"),
    p("reports.item-sales.table", "Item rows", "list", true),
  ],
  "reports.turf-dues": [
    p("reports.turf-dues.toolbar", "Heading & sort", "row"),
    p("reports.turf-dues.list", "Due bookings", "list", true),
  ],

  /* --------------------------- Settings ------------------------- */
  "settings.billing": [
    p("settings.billing.business-name", "Business name", "field", true),
    p("settings.billing.gst", "GST number"),
    p("settings.billing.tax-rate", "Tax rate"),
    p("settings.billing.currency", "Currency"),
  ],
  "settings.turf-rates": [
    p("settings.turf-rates.form", "Add rate form", "panel", true),
    p("settings.turf-rates.list", "Rate list", "list", true),
  ],
};

/* ------------------------------------------------------------------ */
/* Pop-up windows                                                      */
/* ------------------------------------------------------------------ */

export const SURFACE_REGISTRY: SurfaceDef[] = [
  {
    surfaceId: "surface.customer-detail",
    label: "Customer details pop-up",
    parts: [
      p("surface.customer-detail.identity", "Name & phone", "summary", true),
      p("surface.customer-detail.totals", "Spend & dues totals", "summary"),
      p("surface.customer-detail.favorites", "Favourite items", "list"),
      p("surface.customer-detail.history", "Bill & booking history", "list"),
      p("surface.customer-detail.actions", "Action buttons", "action", true),
    ],
  },
  {
    surfaceId: "surface.merge-bill",
    label: "Merge bill pop-up",
    parts: [
      p("surface.merge-bill.explainer", "Explanation text", "summary"),
      p("surface.merge-bill.candidates", "Bills to merge", "list", true),
      p("surface.merge-bill.preview", "Merged total preview", "summary"),
      p("surface.merge-bill.actions", "Confirm & cancel", "action", true),
    ],
  },
  {
    surfaceId: "surface.merge-customers",
    label: "Merge customers pop-up",
    parts: [
      p("surface.merge-customers.explainer", "Explanation text", "summary"),
      p("surface.merge-customers.keep", "Customer to keep", "field", true),
      p("surface.merge-customers.merge", "Customers to merge in", "list", true),
      p("surface.merge-customers.actions", "Confirm & cancel", "action", true),
    ],
  },
  {
    surfaceId: "surface.archive-year",
    label: "Archive year pop-up",
    parts: [
      p("surface.archive-year.explainer", "Explanation text", "summary"),
      p("surface.archive-year.year", "Year picker", "field", true),
      p("surface.archive-year.summary", "What will be archived", "summary"),
      p("surface.archive-year.actions", "Confirm & cancel", "action", true),
    ],
  },
  {
    surfaceId: "surface.booking-extras",
    label: "Discount & notes pop-up",
    parts: [
      p("surface.booking-extras.discount", "Discount amount", "field"),
      p("surface.booking-extras.notes", "Notes"),
      p("surface.booking-extras.actions", "Clear & apply", "action", true),
    ],
  },
];

export function surfaceDef(surfaceId: string): SurfaceDef | undefined {
  return SURFACE_REGISTRY.find((s) => s.surfaceId === surfaceId);
}

export function partsForSection(sectionId: string): PartDef[] {
  return SECTION_PARTS[sectionId] ?? [];
}

export function partDef(id: string): PartDef | undefined {
  for (const list of Object.values(SECTION_PARTS)) {
    const hit = list.find((x) => x.id === id);
    if (hit) return hit;
  }
  for (const s of SURFACE_REGISTRY) {
    const hit = s.parts.find((x) => x.id === id);
    if (hit) return hit;
  }
  return undefined;
}

export function partLabel(id: string): string {
  return partDef(id)?.label ?? id;
}

export function partKind(id: string): PartKind {
  return partDef(id)?.kind ?? "row";
}
