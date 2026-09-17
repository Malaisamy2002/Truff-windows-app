import { useCallback, useEffect, useState } from "react";

export type SortDir = "asc" | "desc";

export type SortOption<T extends string> = {
  value: T;
  label: string;
  /** Default direction when this field is first selected. Defaults to "desc". */
  defaultDir?: SortDir;
};

export type SortState<T extends string> = {
  field: T;
  dir: SortDir;
};

const PREFIX = "ks:sort:";

function readSortState<T extends string>(
  storageKey: string,
  fallback: SortState<T>,
): SortState<T> {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SortState<T>>;
    if (!parsed.field || (parsed.dir !== "asc" && parsed.dir !== "desc"))
      return fallback;
    return { field: parsed.field, dir: parsed.dir };
  } catch {
    return fallback;
  }
}

function writeSortState<T extends string>(
  storageKey: string,
  value: SortState<T>,
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PREFIX + storageKey, JSON.stringify(value));
}

/**
 * Shared sort-state hook: persists { field, dir } to localStorage under a
 * per-section key, so a user's sort choice (e.g. on Bills) survives a reload.
 *
 * @param storageKey unique key for this section, e.g. "bills", "turf-bookings"
 * @param options the sortable fields for this section (used to look up defaultDir)
 * @param initial the field/dir to use the very first time (before anything is saved)
 */
export function useSortState<T extends string>(
  storageKey: string,
  options: SortOption<T>[],
  initial: SortState<T>,
) {
  const [state, setState] = useState<SortState<T>>(() =>
    readSortState(storageKey, initial),
  );

  useEffect(() => {
    writeSortState(storageKey, state);
  }, [storageKey, state]);

  const setField = useCallback(
    (field: T) => {
      setState((prev) => {
        if (prev.field === field) return prev;
        const opt = options.find((o) => o.value === field);
        return { field, dir: opt?.defaultDir ?? "desc" };
      });
    },
    [options],
  );

  const toggleDir = useCallback(() => {
    setState((prev) => ({ ...prev, dir: prev.dir === "asc" ? "desc" : "asc" }));
  }, []);

  /** Cycle to a specific field, useful for single-button "sort by X" UIs. */
  const cycle = useCallback((field: T, dir: SortDir) => {
    setState({ field, dir });
  }, []);

  return { field: state.field, dir: state.dir, setField, toggleDir, cycle };
}

/** Generic comparator helper: compares two values honoring asc/desc. */
export function compareBy<V extends string | number>(
  a: V,
  b: V,
  dir: SortDir,
): number {
  const cmp =
    typeof a === "string"
      ? a.localeCompare(b as string)
      : (a as number) - (b as number);
  return dir === "asc" ? cmp : -cmp;
}

/**
 * A short filename-safe suffix describing the current sort, e.g. "date-desc".
 * Append to export filenames so an exported file's row order isn't a mystery
 * later (e.g. `bills-${sortSuffix(sort.field, sort.dir)}`).
 */
export function sortSuffix(field: string, dir: SortDir): string {
  return `${field}-${dir}`;
}

/**
 * A calendar `Date` (picked in the user's local timezone, e.g. from the
 * calendar-popup date picker) rendered as a plain `YYYY-MM-DD` key — the
 * same shape the app already stores for booking_date/sale_date/spent_at and
 * derives (via dayKey) for bill_date. Deliberately uses local getters, not
 * UTC, so the day the user clicked is the day that comes back.
 */
export function dateKeyFromDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
