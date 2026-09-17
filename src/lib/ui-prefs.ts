import { useEffect, useState } from "react";

/**
 * Generic localStorage-backed UI preference: the active top-level tab, which
 * Settings sections are expanded, etc. Mirrors the pattern in `sort.ts`
 * (per-key persistence, JSON-encoded, safe on the server) but for arbitrary
 * shapes instead of just `{ field, dir }`, so a page reload restores exactly
 * where the person left off instead of resetting to the app's defaults.
 */
const PREFIX = "ks:ui:";

function readPref<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writePref<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full/unavailable — the in-memory state still works this session */
  }
}

/**
 * `useState` that persists to localStorage under `ks:ui:<key>` and restores
 * itself on the next load/refresh. `validate` can reject a stored value that
 * no longer makes sense (e.g. a tab id that was removed) and fall back to
 * `initial` instead.
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
  validate?: (value: T) => boolean,
) {
  const [state, setState] = useState<T>(() => {
    const stored = readPref<T>(key, initial);
    return validate && !validate(stored) ? initial : stored;
  });

  useEffect(() => {
    writePref(key, state);
  }, [key, state]);

  return [state, setState] as const;
}

/**
 * Same read/write pair as `usePersistedState`, but for plain (non-React)
 * code that needs to check or update a persisted UI preference from outside
 * a component — e.g. a header button marking a Settings section as open
 * before navigating there.
 */
export function readPersisted<T>(key: string, fallback: T): T {
  return readPref(key, fallback);
}

export function writePersisted<T>(key: string, value: T) {
  writePref(key, value);
}

/**
 * Marks a Settings accordion section as open, so navigating there (e.g. from
 * a header button) lands with that section already expanded instead of
 * making the person find and open it themselves. Additive — any other
 * sections the person already had open stay open.
 */
export function openSettingsSection(sectionId: string) {
  const current = readPersisted<string[]>("settings-open-sections", []);
  if (!current.includes(sectionId)) {
    writePersisted("settings-open-sections", [...current, sectionId]);
  }
}
