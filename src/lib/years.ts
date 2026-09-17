import { useEffect, useState } from "react";
import { db } from "./localdb";

/**
 * Year handling for the ledger.
 *
 * Every dated table is already indexed by its date column, so a year is fetched
 * with an indexed range query instead of loading the whole table — this is what
 * keeps the app responsive at 100k+ rows.
 */

/** Dated tables and the date column each one is filtered/indexed by. */
export const YEAR_TABLES = {
  bills: "bill_date",
  expenses: "spent_at",
  turf_bookings: "booking_date",
  snack_sales: "sale_date",
  history_entries: "created_at",
} as const;

export type YearTable = keyof typeof YEAR_TABLES;

/** How many years of data stay inside the app. Older years get archived out. */
export const RETAINED_YEARS = 3;

export const currentYear = () => new Date().getFullYear();

export const yearOf = (value: unknown) => {
  const s = String(value ?? "");
  const n = Number(s.slice(0, 4));
  return Number.isFinite(n) && n > 1900 ? n : 0;
};

export const yearStart = (year: number) => `${year}-01-01`;
export const yearEndExclusive = (year: number) => `${year + 1}-01-01`;

/** All rows of one dated table for one year, via the date index. */
export async function rowsForYear<T = Record<string, unknown>>(
  name: YearTable,
  year: number,
): Promise<T[]> {
  const field = YEAR_TABLES[name];
  const tbl = db[name] as unknown as {
    where: (f: string) => {
      between: (
        a: string,
        b: string,
        ia: boolean,
        ib: boolean,
      ) => { toArray: () => Promise<T[]> };
    };
  };
  return tbl
    .where(field)
    .between(yearStart(year), yearEndExclusive(year), true, false)
    .toArray();
}

/** Rows for a set of years (used by the screens, which show the selected year). */
export async function rowsForYears<T = Record<string, unknown>>(
  name: YearTable,
  years: number[] | "all",
): Promise<T[]> {
  if (years === "all")
    return await (
      db[name] as never as { toArray: () => Promise<T[]> }
    ).toArray();
  const out: T[] = [];
  for (const y of years) out.push(...(await rowsForYear<T>(name, y)));
  return out;
}

export async function countForYear(name: YearTable, year: number) {
  const field = YEAR_TABLES[name];
  const tbl = db[name] as unknown as {
    where: (f: string) => {
      between: (
        a: string,
        b: string,
        ia: boolean,
        ib: boolean,
      ) => { count: () => Promise<number> };
    };
  };
  return tbl
    .where(field)
    .between(yearStart(year), yearEndExclusive(year), true, false)
    .count();
}

/** Distinct years present across every dated table, ascending. */
export async function distinctYears(): Promise<number[]> {
  const found = new Set<number>();
  for (const [name, field] of Object.entries(YEAR_TABLES) as [
    YearTable,
    string,
  ][]) {
    const tbl = db[name] as unknown as {
      orderBy: (f: string) => {
        eachUniqueKey?: (cb: (k: unknown) => void) => Promise<void>;
        keys: () => Promise<unknown[]>;
      };
    };
    try {
      const keys = await tbl.orderBy(field).keys();
      for (const k of keys) {
        const y = yearOf(k);
        if (y) found.add(y);
      }
    } catch {
      /* table missing/empty — skip */
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** Deletes every row of one year from the dated tables. Returns rows removed. */
export async function deleteYear(year: number) {
  let removed = 0;
  for (const [name, field] of Object.entries(YEAR_TABLES) as [
    YearTable,
    string,
  ][]) {
    const tbl = db[name] as unknown as {
      where: (f: string) => {
        between: (
          a: string,
          b: string,
          ia: boolean,
          ib: boolean,
        ) => { delete: () => Promise<number> };
      };
    };
    removed += await tbl
      .where(field)
      .between(yearStart(year), yearEndExclusive(year), true, false)
      .delete();
  }
  return removed;
}

/* ------------------------------------------------------------------ */
/* Selected year (shared across screens)                               */
/* ------------------------------------------------------------------ */

const KEY = "ks:selected-year";
const EVENT = "ks:selected-year-changed";

export function readSelectedYear(): number {
  if (typeof window === "undefined") return currentYear();
  const raw = window.localStorage.getItem(KEY);
  const n = Number(raw);
  return Number.isFinite(n) && n > 1900 ? n : currentYear();
}

export function writeSelectedYear(year: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, String(year));
  window.dispatchEvent(new CustomEvent(EVENT));
}

/**
 * The year the screens are showing. It follows the calendar automatically: when
 * a new year begins the app simply switches to it, no action needed. Stored
 * selections from older years are kept until the user changes them.
 */
export function useSelectedYear() {
  const [year, setYear] = useState<number>(() => readSelectedYear());

  useEffect(() => {
    const sync = () => setYear(readSelectedYear());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return [year, writeSelectedYear] as const;
}

/** Years that should appear in the picker: everything in the db plus this year. */
export function useAvailableYears() {
  const [years, setYears] = useState<number[]>([currentYear()]);
  useEffect(() => {
    let alive = true;
    distinctYears().then((list) => {
      if (!alive) return;
      const all = new Set([...list, currentYear()]);
      setYears([...all].sort((a, b) => b - a));
    });
    return () => {
      alive = false;
    };
  }, []);
  return years;
}

/**
 * Years the screens load for a selection. During January the previous year is
 * included too, so "yesterday"/last-month comparisons still work right after a
 * year rollover.
 */
export function yearsWindow(selected: number) {
  const now = new Date();
  return selected === now.getFullYear() && now.getMonth() === 0
    ? [selected - 1, selected]
    : [selected];
}

/** React helper: the year window currently being displayed. */
export function useYearWindow() {
  const [year] = useSelectedYear();
  return { year, years: yearsWindow(year) };
}
