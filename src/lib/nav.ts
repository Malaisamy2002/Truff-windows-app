/**
 * Cross-tab navigation from inside a tab's own content — e.g. Home's
 * "Quick actions" jumping straight to Bookings/Sell/Outstanding/Expenses, or
 * the Customers tab's "New booking"/"New sale" row actions jumping to
 * Turf/Snacks with that customer's name and phone already filled in.
 *
 * The tab switcher itself lives in `routes/index.tsx` (state is local to
 * that component, one per app), so this dispatches a plain DOM event rather
 * than prop-drilling a setter through every tab. `routes/index.tsx` listens
 * for `"nav:goto"` and calls its own `setTab`, ignoring unknown ids — the
 * same pattern already used for `"arrange:start"` (see
 * `LayoutSettingsCard.tsx`). The optional `customer` field is read by
 * `routes/index.tsx` and passed down as the `prefillCustomer` prop to
 * whichever tab matches (see `TurfTab`/`SnacksTab`).
 */
export function goToTab(
  tabId: string,
  customer?: { name: string; phone: string | null },
) {
  window.dispatchEvent(
    new CustomEvent("nav:goto", {
      detail: {
        tab: tabId,
        customerName: customer?.name,
        customerPhone: customer?.phone ?? null,
      },
    }),
  );
}
