import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Local (device-timezone) calendar date as "YYYY-MM-DD".
 *
 * `new Date().toISOString().slice(0, 10)` is a common but wrong pattern for
 * "today": toISOString() always renders in UTC, so for IST (UTC+5:30) it
 * returns yesterday's date for the first ~5.5 hours after local midnight.
 * Use this helper anywhere a plain local calendar-date string is needed.
 */
export function localDateStr(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
