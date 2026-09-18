import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  db,
  newId,
  nowIso,
  sortBy,
  type DayCloseHistoryRow,
  type DayCloseRow,
} from "./localdb";
import { readCache, writeCache } from "./data";
import { rupees } from "./money";

/**
 * End-of-day cash-drawer reconciliation (Dashboard's "Close day" flow).
 *
 * The dashboard already computes a live `expectedInDrawer` figure
 * (`cashCollectedToday - cashExpensesToday`). This module is the guided
 * process around that number that DashboardTab's cash-drawer card
 * previously lacked: enter what was actually counted, see the variance,
 * and save a record that the day was closed. See PROGRESS-NOTES.md for the
 * "confirmed not found, but closer than it looked" note this closes out.
 */

export type DayClose = {
  id: string;
  day: string;
  expectedInDrawer: number;
  countedCash: number;
  variance: number;
  note: string | null;
  closedAt: string;
};

const fromRow = (r: DayCloseRow): DayClose => ({
  id: r.id,
  day: r.day,
  expectedInDrawer: Number(r.expected_in_drawer) || 0,
  countedCash: Number(r.counted_cash) || 0,
  variance: Number(r.variance) || 0,
  note: r.note,
  closedAt: r.closed_at,
});

export type DayCloseAmendment = {
  id: string;
  day: string;
  previousExpectedInDrawer: number;
  previousCountedCash: number;
  previousVariance: number;
  previousNote: string | null;
  previousClosedAt: string;
  amendedAt: string;
};

const fromHistoryRow = (r: DayCloseHistoryRow): DayCloseAmendment => ({
  id: r.id,
  day: r.day,
  previousExpectedInDrawer: Number(r.previous_expected_in_drawer) || 0,
  previousCountedCash: Number(r.previous_counted_cash) || 0,
  previousVariance: Number(r.previous_variance) || 0,
  previousNote: r.previous_note,
  previousClosedAt: r.previous_closed_at,
  amendedAt: r.amended_at,
});

/** Every close-out record, most recent day first. */
export function useDayCloses() {
  return useQuery({
    queryKey: ["day_closes"],
    initialData: () => readCache<DayClose[]>("day_closes", []),
    queryFn: async () => {
      const rows = sortBy(await db.day_closes.toArray(), "day", "desc").map(
        fromRow,
      );
      writeCache("day_closes", rows);
      return rows;
    },
  });
}

/** Prior versions of one day's close record, most recent amendment first.
 * Empty for a day that's only ever been closed once. */
export function useDayCloseHistory(day: string) {
  return useQuery({
    queryKey: ["day_close_history", day],
    queryFn: async () => {
      const rows = await db.day_close_history
        .where("day")
        .equals(day)
        .toArray();
      return sortBy(rows, "amended_at", "desc").map(fromHistoryRow);
    },
    enabled: !!day,
  });
}

/**
 * counted - expected, rounded the same whole-rupee way as every other
 * amount in the app. Positive: more cash in the drawer than expected.
 * Negative: less than expected (a shortfall).
 */
export const dayCloseVariance = (
  expectedInDrawer: number,
  countedCash: number,
) => rupees(countedCash) - rupees(expectedInDrawer);

export type CloseDayInput = {
  day: string;
  expectedInDrawer: number;
  countedCash: number;
  note?: string | null;
};

/**
 * `nowIso()` is millisecond-precision, so two amendments to the same day
 * within one event-loop tick (e.g. a double-tap on "save") can land on the
 * exact same timestamp. `day_close_history` is ordered by `amended_at` with
 * no other tiebreaker, so a tie made that ordering (and therefore which
 * "previous count" shows first) nondeterministic. This keeps each call
 * strictly after the last one this session, so amendment order is always
 * well-defined regardless of how fast they happen.
 */
let lastAmendedAtMs = 0;
function monotonicAmendedAt(): string {
  const now = Date.now();
  const ms = now > lastAmendedAtMs ? now : lastAmendedAtMs + 1;
  lastAmendedAtMs = ms;
  return new Date(ms).toISOString();
}

/**
 * Close (or re-close) a day. `day` is the natural key — closing again for a
 * day that already has a record amends it in place (same id, fresh
 * `closed_at`) instead of creating a second row, so correcting a mistyped
 * count doesn't leave a stray duplicate behind. Extracted as a plain
 * function (rather than living inline in the mutation) so it's testable
 * without going through React Query, matching how the rest of this layer
 * (e.g. `mergeIntoBill` in merge.ts) separates the db operation from its
 * hook wrapper.
 */
export async function closeDay(payload: CloseDayInput): Promise<DayClose> {
  const expected = rupees(payload.expectedInDrawer);
  const counted = rupees(payload.countedCash);
  const existing = await db.day_closes.where("day").equals(payload.day).first();
  // Amending an existing close: record what it held right before this
  // write overwrites it, so a corrected count never quietly erases the
  // figure that was originally signed off.
  if (existing) {
    const historyRow: DayCloseHistoryRow = {
      id: newId(),
      day: existing.day,
      previous_expected_in_drawer: existing.expected_in_drawer,
      previous_counted_cash: existing.counted_cash,
      previous_variance: existing.variance,
      previous_note: existing.note,
      previous_closed_at: existing.closed_at,
      amended_at: monotonicAmendedAt(),
    };
    await db.day_close_history.put(historyRow);
  }
  const row: DayCloseRow = {
    id: existing?.id ?? newId(),
    day: payload.day,
    expected_in_drawer: expected,
    counted_cash: counted,
    variance: dayCloseVariance(expected, counted),
    note: payload.note?.trim() || null,
    closed_at: nowIso(),
    created_at: existing?.created_at ?? nowIso(),
  };
  await db.day_closes.put(row);
  return fromRow(row);
}

export function useCloseDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: closeDay,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["day_closes"] }),
  });
}
