import { usePersistedState } from "./ui-prefs";

/**
 * The plan's Section 6 first-run checklist: Business details → Turf rates →
 * Courts & durations → Snack catalog → Payment methods → Printer/receipt
 * settings → Backup setup → First test booking.
 *
 * Every step here is SELF-REPORTED (the owner ticks it, nothing is inferred
 * from data) — deliberately, not for lack of trying. Most of the settings
 * this checklist points at (turf rates, slot durations, printer/receipt
 * settings) ship pre-seeded with sensible working defaults (see
 * DEFAULT_TURF_RATES in ops.ts, DEFAULT_PRINT_SETTINGS in print.ts), and this
 * install's own defaults already carry a real-looking business name/address/
 * phone — so "is a value present" can't tell a fresh install the owner
 * hasn't touched yet from one they've already reviewed and are happy with.
 * A checkbox the owner controls is honest about that; a checklist that's
 * silently 6/8 "done" on first launch because of seed data would not be.
 *
 * The two genuinely data-safe exceptions (`lastBackupAt`, first booking) are
 * intentionally NOT special-cased here — see `useFirstRunChecklist`'s doc
 * comment for why they're still plain checkboxes too, for consistency.
 */
export type FirstRunStep = {
  id: string;
  title: string;
  description: string;
} & (
  | { kind: "settings-section"; sectionValue: string }
  | { kind: "goto-tab"; tab: string }
);

export const FIRST_RUN_STEPS: FirstRunStep[] = [
  {
    id: "business-details",
    title: "Business details",
    description: "Shop name, address, phone and GST/tax settings.",
    kind: "settings-section",
    sectionValue: "billing",
  },
  {
    id: "turf-rates",
    title: "Turf rates",
    description: "Hourly rates for each slot (weekday/weekend, etc.).",
    kind: "settings-section",
    sectionValue: "turf-rates",
  },
  {
    id: "courts-durations",
    title: "Courts & slot durations",
    description: "How many courts you have and which slot lengths to allow.",
    kind: "settings-section",
    sectionValue: "turf-rates",
  },
  {
    id: "snack-catalog",
    title: "Snack catalog",
    description: "Add the items you sell, with price and stock.",
    kind: "settings-section",
    sectionValue: "snack-items",
  },
  {
    id: "payment-methods",
    title: "Payment methods",
    description: "UPI ID and QR so bills can show a Scan & Pay code.",
    kind: "settings-section",
    sectionValue: "print",
  },
  {
    id: "printer",
    title: "Printer & receipt settings",
    description: "Paper size, template style and what prints on receipts.",
    kind: "settings-section",
    sectionValue: "print",
  },
  {
    id: "backup",
    title: "Backup setup",
    description: "Turn on backup reminders and take your first export.",
    kind: "settings-section",
    sectionValue: "backup",
  },
  {
    id: "first-booking",
    title: "First test booking",
    description:
      "Create one real (or test) booking to see the flow end to end.",
    kind: "goto-tab",
    tab: "turf",
  },
];

const DONE_KEY = "first-run-checklist-done";
const DISMISSED_KEY = "first-run-checklist-dismissed";

/**
 * Persisted checklist completion, same `usePersistedState` pattern already
 * used for `settings-open-sections` etc. Kept fully self-reported (see
 * FIRST_RUN_STEPS' doc comment) rather than mixing in a couple of
 * data-inferred steps — a checklist where most rows are "tick it yourself"
 * but two silently tick themselves is a confusing inconsistency for the one
 * screen whose whole job is being easy to trust at a glance.
 */
export function useFirstRunChecklist() {
  const [doneIds, setDoneIds] = usePersistedState<string[]>(DONE_KEY, []);
  const [dismissed, setDismissed] = usePersistedState<boolean>(
    DISMISSED_KEY,
    false,
  );
  const doneSet = new Set(doneIds);

  const toggle = (id: string) => {
    setDoneIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  };

  const percent = Math.round((doneSet.size / FIRST_RUN_STEPS.length) * 100);

  return {
    steps: FIRST_RUN_STEPS,
    doneSet,
    toggle,
    percent,
    dismissed,
    setDismissed,
  };
}
