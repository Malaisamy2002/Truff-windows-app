import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_THEME,
  applyCachedMode,
  applyTheme,
  themeToCssVars,
} from "./theme";

/**
 * theme.ts talks to `document`/`window`/`localStorage` directly (it's only
 * ever called client-side), so this test environment — plain Node, no jsdom
 * — needs a minimal stand-in for each. Same pattern as the `withLiveGstOn`
 * stub in receipt.test.ts, just extended to cover `document` too since
 * applyTheme/applyCachedMode both write to `document.documentElement`.
 */
function installDomStub() {
  const store = new Map<string, string>();
  const styleProps = new Map<string, string>();
  const classes = new Set<string>();

  const localStorageStub = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };

  const documentStub = {
    documentElement: {
      style: {
        setProperty: (name: string, value: string) => {
          styleProps.set(name, value);
        },
      },
      classList: {
        toggle: (cls: string, force?: boolean) => {
          if (force) classes.add(cls);
          else classes.delete(cls);
        },
      },
    },
  };

  const windowStub = {
    localStorage: localStorageStub,
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  (globalThis as Record<string, unknown>)["window"] = windowStub;
  (globalThis as Record<string, unknown>)["document"] = documentStub;
  (globalThis as Record<string, unknown>)["localStorage"] = localStorageStub;

  return { styleProps, classes };
}

function uninstallDomStub() {
  delete (globalThis as Record<string, unknown>)["window"];
  delete (globalThis as Record<string, unknown>)["document"];
  delete (globalThis as Record<string, unknown>)["localStorage"];
}

describe("themeToCssVars (pure colour math)", () => {
  it("is deterministic — same theme + mode always resolves to the same vars", () => {
    const a = themeToCssVars(DEFAULT_THEME, "light");
    const b = themeToCssVars(DEFAULT_THEME, "light");
    expect(a).toEqual(b);
  });

  it("resolves light and dark to genuinely different var sets", () => {
    const light = themeToCssVars(DEFAULT_THEME, "light");
    const dark = themeToCssVars(DEFAULT_THEME, "dark");
    expect(light["--background"]).not.toBe(dark["--background"]);
  });
});

describe("resolved-CSS cache (applyTheme -> applyCachedMode)", () => {
  let stub: ReturnType<typeof installDomStub>;

  beforeEach(() => {
    stub = installDomStub();
  });

  afterEach(() => {
    uninstallDomStub();
  });

  it("returns false when nothing has been cached yet", () => {
    expect(applyCachedMode("light")).toBe(false);
    expect(applyCachedMode("dark")).toBe(false);
  });

  it("caches BOTH modes on a single applyTheme call, so the other mode is available from cache immediately", () => {
    applyTheme(DEFAULT_THEME, "light");
    // Dark was never explicitly applied, only computed and cached alongside light.
    expect(applyCachedMode("dark")).toBe(true);
  });

  it("restores byte-identical values from cache — no drift from re-running the colour maths", () => {
    const expectedLight = themeToCssVars(DEFAULT_THEME, "light");
    const expectedDark = themeToCssVars(DEFAULT_THEME, "dark");

    applyTheme(DEFAULT_THEME, "light");

    stub.styleProps.clear();
    expect(applyCachedMode("dark")).toBe(true);
    expect(Object.fromEntries(stub.styleProps)).toEqual(expectedDark);
    expect(stub.classes.has("dark")).toBe(true);

    stub.styleProps.clear();
    expect(applyCachedMode("light")).toBe(true);
    expect(Object.fromEntries(stub.styleProps)).toEqual(expectedLight);
    expect(stub.classes.has("dark")).toBe(false);
  });

  it("keeps returning the same cached values across repeated light <-> dark toggles", () => {
    const expectedLight = themeToCssVars(DEFAULT_THEME, "light");
    const expectedDark = themeToCssVars(DEFAULT_THEME, "dark");
    applyTheme(DEFAULT_THEME, "light");

    for (let i = 0; i < 4; i++) {
      stub.styleProps.clear();
      applyCachedMode("dark");
      expect(Object.fromEntries(stub.styleProps)).toEqual(expectedDark);

      stub.styleProps.clear();
      applyCachedMode("light");
      expect(Object.fromEntries(stub.styleProps)).toEqual(expectedLight);
    }
  });

  it("re-caches both modes whenever applyTheme runs again (e.g. after picking a new colour)", () => {
    const customTheme = {
      ...DEFAULT_THEME,
      primary: "#20a060",
      background: "#f5fff8",
    };
    applyTheme(DEFAULT_THEME, "light");
    applyTheme(customTheme, "dark");

    const expectedLight = themeToCssVars(customTheme, "light");
    stub.styleProps.clear();
    expect(applyCachedMode("light")).toBe(true);
    expect(Object.fromEntries(stub.styleProps)).toEqual(expectedLight);
  });
});
