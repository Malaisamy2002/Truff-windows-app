/**
 * Custom theme engine — lets the owner pick ANY accent / background colour and
 * applies it live through the design-system CSS custom properties in
 * src/styles.css.
 *
 * IMPORTANT: this design system stores colours as `oklch(...)` values, so the
 * engine writes oklch strings (an older version wrote bare HSL triples, which
 * the browser simply ignored — that is why picking a colour changed nothing).
 *
 * Storage: one localStorage key holding plain hex colours, re-applied before
 * first paint by THEME_INIT_SCRIPT so a saved theme survives a reload.
 */

import { useState, useEffect } from "react";

const STORAGE_KEY = "app-custom-theme";

/**
 * The colours that make up ONE mode (light or dark).
 * `primary` + `background` are required; the rest are optional slots that fall
 * back to auto-derived values when the owner has not picked them.
 */
export interface ThemePair {
  /** Accent colour, hex e.g. "#3b6fd4" */
  primary: string;
  /** App background colour, hex e.g. "#eef4fb" */
  background: string;
  /** Optional second accent used for chips, secondary buttons, hover tints. */
  secondary?: string;
  /** Optional card / panel surface colour. */
  surface?: string;
  /** Optional highlight used for positive figures and the "good" state. */
  highlight?: string;
}

/** The optional slots, in card order, with their labels. */
export const EXTRA_SLOTS = [
  {
    key: "secondary",
    label: "Secondary accent",
    hint: "Chips, secondary buttons, hover tints",
  },
  {
    key: "surface",
    label: "Card surface",
    hint: "Cards, popovers and the sidebar",
  },
  {
    key: "highlight",
    label: "Positive / success",
    hint: "Money in, paid badges, up arrows",
  },
] as const;

export type ExtraSlot = (typeof EXTRA_SLOTS)[number]["key"];

/**
 * A full theme carries a separate colour pair per mode, so light and dark are
 * tuned independently instead of the dark mode being a dimmed guess.
 * `primary` / `background` stay as the light-mode pair for backwards
 * compatibility with anything reading the flat shape.
 */
export interface CustomTheme extends ThemePair {
  /** Dark-mode accent */
  primaryDark: string;
  /** Dark-mode background */
  backgroundDark: string;
  secondaryDark?: string;
  surfaceDark?: string;
  highlightDark?: string;
}

export const DEFAULT_THEME: CustomTheme = {
  primary: "#3f6fd0",
  background: "#eef4fa",
  primaryDark: "#7aa5f5",
  backgroundDark: "#141b28",
};

/** Key of an extra slot for a given mode. */
function slotKey(slot: ExtraSlot, mode: ThemeMode): keyof CustomTheme {
  return (mode === "dark" ? `${slot}Dark` : slot) as keyof CustomTheme;
}

/** Read the pair that should be on screen for a given mode. */
export function pairFor(theme: CustomTheme, mode: ThemeMode): ThemePair {
  const out: ThemePair =
    mode === "dark"
      ? { primary: theme.primaryDark, background: theme.backgroundDark }
      : { primary: theme.primary, background: theme.background };
  for (const { key } of EXTRA_SLOTS) {
    const v = theme[slotKey(key, mode)];
    if (typeof v === "string" && v) out[key] = v;
  }
  return out;
}

/** Patch shape for one mode. `null` clears an extra slot back to auto. */
export type PairPatch = {
  primary?: string;
  background?: string;
} & Partial<Record<ExtraSlot, string | null>>;

/** Write a patch back into the mode it belongs to. */
export function withPair(
  theme: CustomTheme,
  mode: ThemeMode,
  patch: PairPatch,
): CustomTheme {
  const next: CustomTheme = { ...theme };
  if (patch.primary) {
    if (mode === "dark") next.primaryDark = patch.primary;
    else next.primary = patch.primary;
  }
  if (patch.background) {
    if (mode === "dark") next.backgroundDark = patch.background;
    else next.background = patch.background;
  }
  for (const { key } of EXTRA_SLOTS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    const k = slotKey(key, mode);
    if (value === null || value === undefined) delete next[k];
    else (next as unknown as Record<string, string>)[k as string] = value;
  }
  return next;
}

/** Build a sensible dark pair from a light one (brighter accent, deep tinted bg). */
export function deriveDarkPair(light: ThemePair): ThemePair {
  const { c, h } = hexToOklch(light.primary);
  const out: ThemePair = {
    primary: oklchToHex(0.76, Math.min(0.16, Math.max(0.06, c)), h),
    background: oklchToHex(
      0.19,
      Math.min(0.03, hexToOklch(light.background).c + 0.01),
      hexToOklch(light.background).h,
    ),
  };
  if (light.secondary) out.secondary = withLightness(light.secondary, 0.42);
  if (light.surface) out.surface = withLightness(light.surface, 0.25);
  if (light.highlight) out.highlight = withLightness(light.highlight, 0.72);
  return out;
}

/** Build a sensible light pair from a dark one. */
export function deriveLightPair(dark: ThemePair): ThemePair {
  const { c, h } = hexToOklch(dark.primary);
  const out: ThemePair = {
    primary: oklchToHex(0.55, Math.min(0.19, Math.max(0.08, c)), h),
    background: oklchToHex(
      0.97,
      Math.min(0.02, hexToOklch(dark.background).c + 0.008),
      hexToOklch(dark.background).h,
    ),
  };
  if (dark.secondary) out.secondary = withLightness(dark.secondary, 0.92);
  if (dark.surface) out.surface = withLightness(dark.surface, 0.98);
  if (dark.highlight) out.highlight = withLightness(dark.highlight, 0.6);
  return out;
}

const preset = (
  name: string,
  primary: string,
  background: string,
  primaryDark: string,
  backgroundDark: string,
): { name: string; theme: CustomTheme } => ({
  name,
  theme: { primary, background, primaryDark, backgroundDark },
});

/** One-tap themes — each carries its own light AND dark colours. */
export const THEME_PRESETS: { name: string; theme: CustomTheme }[] = [
  { name: "Ice Blue", theme: DEFAULT_THEME },
  preset("Turf Green", "#1f9d63", "#eef7f0", "#4ade80", "#111d17"),
  preset("Sunset", "#e2683a", "#fdf2ec", "#fb923c", "#1f1613"),
  preset("Plum", "#8b5cf6", "#f5f1fd", "#c4a6ff", "#1a1526"),
  preset("Graphite", "#4b5563", "#f4f5f7", "#a9b3c1", "#16181c"),
  preset("Rose", "#d6336c", "#fdf1f5", "#f9789f", "#231318"),
  preset("Teal", "#0f8f8f", "#eaf6f6", "#4ecfcf", "#0f1d1e"),
  preset("Amber", "#b8860b", "#fdf6e6", "#f0c34a", "#1e1a10"),
];

/* ---------------------------------------------------------------------- */
/* Colour conversion — hex <-> oklch                                       */
/* ---------------------------------------------------------------------- */

function normalizeHex(hex: string): string {
  let clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    clean = clean
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return "000000";
  return clean.toLowerCase();
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = normalizeHex(hex);
  return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const linearToSrgb = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

/** hex -> { l (0-1), c, h (deg) } in OKLCh */
export function hexToOklch(hex: string): { l: number; c: number; h: number } {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear) as [number, number, number];

  const lp = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mp = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const sp = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * lp + 0.793617785 * mp - 0.0040720468 * sp;
  const a = 1.9779984951 * lp - 2.428592205 * mp + 0.4505937099 * sp;
  const bb = 0.0259040371 * lp + 0.7827717662 * mp - 0.808675766 * sp;

  const c = Math.sqrt(a * a + bb * bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

/** { l, c, h } -> #rrggbb (clamped into sRGB) */
export function oklchToHex(l: number, c: number, h: number): string {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const rl = 4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp;
  const gl = -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp;
  const bl = -0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp;

  const toHex = (v: number) =>
    Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(rl)}${toHex(gl)}${toHex(bl)}`;
}

/** hex -> the `oklch(l c h)` string the design-system variables expect. */
export function hexToOklchString(hex: string): string {
  const { l, c, h } = hexToOklch(hex);
  return `oklch(${l.toFixed(4)} ${c.toFixed(4)} ${h.toFixed(2)})`;
}

/** Shift a colour's lightness / chroma while keeping its hue — used for the
 * derived surface tokens (cards, muted, borders) so a custom background stays
 * coherent instead of clashing with the stock ice-blue surfaces. */
function shade(hex: string, lightness: number, chromaScale = 1): string {
  const { c, h } = hexToOklch(hex);
  return `oklch(${lightness.toFixed(4)} ${(c * chromaScale).toFixed(4)} ${h.toFixed(2)})`;
}

/* ---------------------------------------------------------------------- */
/* Hue-preserving tweaks used by the lightness / intensity sliders         */
/* ---------------------------------------------------------------------- */

/** Lightness of a hex colour, 0-1. */
export function lightnessOf(hex: string): number {
  return hexToOklch(hex).l;
}

/** Chroma (colour intensity) of a hex colour. */
export function chromaOf(hex: string): number {
  return hexToOklch(hex).c;
}

/** Same hue + chroma, new lightness. */
export function withLightness(hex: string, l: number): string {
  const { c, h } = hexToOklch(hex);
  return oklchToHex(Math.min(0.99, Math.max(0.05, l)), c, h);
}

/** Same hue + lightness, new chroma (0 = grey, ~0.32 = vivid). */
export function withChroma(hex: string, c: number): string {
  const { l, h } = hexToOklch(hex);
  return oklchToHex(l, Math.min(0.37, Math.max(0, c)), h);
}

/* ---------------------------------------------------------------------- */
/* Contrast — auto-flip foreground text between near-black and near-white  */
/* ---------------------------------------------------------------------- */

/** WCAG relative luminance of a hex colour. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours (1 = identical, 21 = max). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const NEAR_BLACK = "#16202e";
const NEAR_WHITE = "#fbfcfe";

/**
 * Given any hex colour, return the readable foreground (as an oklch string)
 * out of near-black / near-white — whichever actually contrasts more. This is
 * a real contrast comparison rather than a lightness threshold, so pale
 * yellows and mid greens no longer end up with unreadable white text.
 */
export function readableForeground(hex: string): string {
  const useDark =
    contrastRatio(hex, NEAR_BLACK) >= contrastRatio(hex, NEAR_WHITE);
  return hexToOklchString(useDark ? NEAR_BLACK : NEAR_WHITE);
}

/**
 * Nudge an accent's lightness until it clears a readable contrast against its
 * own auto-picked foreground. Keeps hue and chroma, so the colour the owner
 * picked is still recognisably theirs.
 */
function contrastSafeAccent(hex: string): string {
  const fgDark =
    contrastRatio(hex, NEAR_BLACK) >= contrastRatio(hex, NEAR_WHITE);
  const fg = fgDark ? NEAR_BLACK : NEAR_WHITE;
  let out = hex;
  for (let i = 0; i < 14 && contrastRatio(out, fg) < 3.4; i++) {
    // Push away from the foreground: darken against white text, lighten against black.
    out = withLightness(out, lightnessOf(out) + (fgDark ? 0.03 : -0.03));
  }
  return out;
}

/* ---------------------------------------------------------------------- */
/* Apply to document + persistence                                         */
/* ---------------------------------------------------------------------- */

/** localStorage key holding the resolved CSS variables, so the pre-paint init
 * script can restore them without re-running the colour math. */
const CSS_KEY = "app-custom-theme-css";

const THEMED_VARS = [
  "--primary",
  "--primary-foreground",
  "--ring",
  "--sidebar-primary",
  "--sidebar-ring",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
  "--background",
  "--foreground",
  "--sidebar",
  "--sidebar-foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--muted",
  "--muted-foreground",
  "--secondary",
  "--secondary-foreground",
  "--accent",
  "--accent-foreground",
  "--border",
  "--input",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--success",
  "--success-foreground",
  "--turf",
] as const;

/**
 * Resolve a theme into the CSS custom properties the design system uses, for
 * one specific mode. Dark mode is not a dimmed copy of light: it uses the
 * theme's own dark pair and its own surface/contrast ramp.
 */
export function themeToCssVars(
  theme: CustomTheme,
  mode: ThemeMode = "light",
): Record<string, string> {
  const dark = mode === "dark";
  const pair = pairFor(theme, mode);
  const accent = contrastSafeAccent(pair.primary);
  const primary = hexToOklchString(accent);
  const bg = hexToOklchString(pair.background);
  // Clamp the background into a sane range for its mode so a badly chosen
  // colour can never make text unreadable.
  const rawL = hexToOklch(pair.background).l;
  const bgL = dark ? Math.min(rawL, 0.34) : Math.max(rawL, 0.9);
  const base = withLightness(pair.background, bgL);
  const fg = readableForeground(base);
  const { c: aC, h: aH } = hexToOklch(accent);
  /** Chart series: same lightness/chroma feel as the accent, hues spread around it. */
  const chart = (offset: number) =>
    `oklch(${(dark ? 0.74 : 0.56).toFixed(2)} ${Math.max(0.09, Math.min(0.17, aC)).toFixed(4)} ${(((aH + offset) % 360) + 360) % 360})`;

  const vars: Record<string, string> = {
    "--primary": primary,
    "--primary-foreground": readableForeground(accent),
    "--ring": primary,
    "--sidebar-primary": primary,
    "--sidebar-ring": primary,
    "--background": dark ? hexToOklchString(base) : bg,
    "--foreground": fg,
    "--sidebar": shade(base, dark ? bgL + 0.03 : bgL * 0.99, 0.9),
    "--sidebar-foreground": fg,
    // Derived surfaces keep the background's hue so cards/borders stay coherent.
    "--card": shade(
      base,
      dark ? bgL + 0.05 : Math.min(0.995, bgL + 0.02),
      0.35,
    ),
    "--card-foreground": fg,
    "--popover": shade(
      base,
      dark ? bgL + 0.07 : Math.min(0.995, bgL + 0.025),
      0.25,
    ),
    "--popover-foreground": fg,
    "--muted": shade(base, dark ? bgL + 0.07 : bgL - 0.03, 0.8),
    "--muted-foreground": shade(base, dark ? 0.76 : 0.48, 0.35),
    "--secondary": shade(base, dark ? bgL + 0.09 : bgL - 0.04, 0.9),
    "--secondary-foreground": fg,
    "--accent": shade(base, dark ? bgL + 0.11 : bgL - 0.05, 0.9),
    "--accent-foreground": fg,
    "--sidebar-accent": shade(base, dark ? bgL + 0.11 : bgL - 0.05, 0.9),
    "--sidebar-accent-foreground": fg,
    "--border": shade(base, dark ? bgL + 0.16 : bgL - 0.1, 0.7),
    "--sidebar-border": shade(base, dark ? bgL + 0.16 : bgL - 0.1, 0.7),
    "--input": shade(base, dark ? bgL + 0.2 : bgL - 0.12, 0.7),
    "--chart-1": chart(0),
    "--chart-2": chart(150),
    "--chart-3": chart(60),
    "--chart-4": chart(280),
    "--chart-5": chart(205),
  };

  // --- Optional owner-picked slots. Each one overrides its auto-derived
  // tokens (and their foregrounds) only when the owner has actually set it.
  if (pair.secondary) {
    // Keep the picked hue but hold it inside a sane range for the mode, so a
    // near-black pick in light mode can't swallow the chips.
    const sec = withLightness(
      pair.secondary,
      dark
        ? Math.min(Math.max(lightnessOf(pair.secondary), 0.22), 0.45)
        : Math.min(Math.max(lightnessOf(pair.secondary), 0.78), 0.96),
    );
    const secFg = readableForeground(sec);
    vars["--secondary"] = hexToOklchString(sec);
    vars["--secondary-foreground"] = secFg;
    vars["--accent"] = hexToOklchString(sec);
    vars["--accent-foreground"] = secFg;
    vars["--sidebar-accent"] = hexToOklchString(sec);
    vars["--sidebar-accent-foreground"] = secFg;
  }

  if (pair.surface) {
    const surf = withLightness(
      pair.surface,
      dark
        ? Math.min(Math.max(lightnessOf(pair.surface), 0.15), 0.38)
        : Math.min(Math.max(lightnessOf(pair.surface), 0.85), 0.995),
    );
    const surfFg = readableForeground(surf);
    const { c: sC, h: sH } = hexToOklch(surf);
    const sL = lightnessOf(surf);
    // Popover sits one step off the card so layered panels stay distinct.
    const pop = `oklch(${(dark ? Math.min(0.44, sL + 0.03) : Math.max(0.8, sL - 0.015)).toFixed(4)} ${sC.toFixed(4)} ${sH.toFixed(2)})`;
    vars["--card"] = hexToOklchString(surf);
    vars["--card-foreground"] = surfFg;
    vars["--popover"] = pop;
    vars["--popover-foreground"] = surfFg;
    vars["--sidebar"] = hexToOklchString(surf);
    vars["--sidebar-foreground"] = surfFg;
  }

  if (pair.highlight) {
    const hi = contrastSafeAccent(pair.highlight);
    vars["--success"] = hexToOklchString(hi);
    vars["--success-foreground"] = readableForeground(hi);
    vars["--turf"] = hexToOklchString(hi);
  }

  return vars;
}

/** Push the theme's CSS variables onto :root so every component picks it up. */
export function applyTheme(
  theme: CustomTheme,
  mode: ThemeMode = loadThemeMode(),
) {
  const light = themeToCssVars(theme, "light");
  const dark = themeToCssVars(theme, "dark");
  const vars = mode === "dark" ? dark : light;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  // Keep the `.dark` class in sync so shadcn's own dark variants (shadows,
  // hover tints) agree with the custom variables.
  root.classList.toggle("dark", mode === "dark");
  try {
    // Cache BOTH modes so toggling light <-> dark restores byte-identical
    // values instead of drifting through a second round of colour maths.
    localStorage.setItem(CSS_KEY, JSON.stringify({ light, dark }));
  } catch {
    /* storage full / unavailable — colours still apply for this session */
  }
}

/** Cached, already-resolved CSS for both modes (written by applyTheme). */
function readCachedCss(): Partial<
  Record<ThemeMode, Record<string, string>>
> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CSS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && (parsed["light"] || parsed["dark"])) {
      return parsed as Partial<Record<ThemeMode, Record<string, string>>>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Apply a mode from the cached CSS instead of recomputing the colour maths.
 * The pre-paint script reads the same cache, so light -> dark -> light returns
 * byte-identical values (recomputing drifted by a few thousandths because of
 * clamping). Returns false when nothing is cached for that mode.
 */
export function applyCachedMode(mode: ThemeMode): boolean {
  const vars = readCachedCss()?.[mode];
  if (!vars) return false;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(vars)) {
    if (typeof value === "string") root.style.setProperty(name, value);
  }
  root.classList.toggle("dark", mode === "dark");
  return true;
}

/**
 * Live-preview apply, coalesced to one paint per frame. Dragging a colour
 * wheel fires dozens of updates per second; without this the colour maths and
 * ~30 custom-property writes run on every one of them and the drag stutters.
 */
let pendingFrame: number | null = null;
let pendingTheme: CustomTheme | null = null;
let pendingMode: ThemeMode = "light";
export function applyThemePreview(
  theme: CustomTheme,
  mode: ThemeMode = loadThemeMode(),
) {
  pendingTheme = theme;
  pendingMode = mode;
  if (pendingFrame != null) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = null;
    if (pendingTheme) applyTheme(pendingTheme, pendingMode);
  });
}

/** Accepts the current hex shape and migrates the legacy HSL-triple shape. */
function parseTheme(raw: string | null): CustomTheme {
  if (!raw) return DEFAULT_THEME;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const pick = (hexKey: string, legacyKey: string, fallback: string) => {
      const hex = parsed[hexKey];
      if (typeof hex === "string" && /^#?[0-9a-fA-F]{3,6}$/.test(hex.trim())) {
        return `#${normalizeHex(hex)}`;
      }
      const legacy = parsed[legacyKey];
      if (typeof legacy === "string") {
        const [h = 0, s = 0, l = 0] = legacy
          .replace(/%/g, "")
          .split(" ")
          .map((v) => parseFloat(v));
        // Rough HSL -> hex so an older saved theme is not silently lost.
        const sN = s / 100;
        const lN = l / 100;
        const k = (n: number) => (n + h / 30) % 12;
        const f = (n: number) =>
          lN -
          sN *
            Math.min(lN, 1 - lN) *
            Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
        const toHex = (v: number) =>
          Math.round(v * 255)
            .toString(16)
            .padStart(2, "0");
        return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
      }
      return fallback;
    };
    /** Optional slot: kept only when the save actually holds a valid hex. */
    const optional = (key: string): string | undefined => {
      const v = parsed[key];
      if (typeof v === "string" && /^#?[0-9a-fA-F]{3,6}$/.test(v.trim())) {
        return `#${normalizeHex(v)}`;
      }
      return undefined;
    };
    /** Collect the extra slots for one mode into a patch-shaped object. */
    const extras = (suffix: "" | "Dark") => {
      const out: Partial<Record<string, string>> = {};
      for (const { key } of EXTRA_SLOTS) {
        const v = optional(`${key}${suffix}`);
        if (v) out[`${key}${suffix}`] = v;
      }
      return out;
    };
    const light: ThemePair = {
      primary: pick("primary", "primaryHsl", DEFAULT_THEME.primary),
      background: pick("background", "backgroundHsl", DEFAULT_THEME.background),
      ...extras(""),
    };
    // Older saves had one pair only. If its background was dark, treat it as
    // the dark pair and derive a matching light one, and vice versa.
    const hasDark = typeof parsed["primaryDark"] === "string";
    if (hasDark) {
      return {
        ...light,
        primaryDark: pick("primaryDark", "__", DEFAULT_THEME.primaryDark),
        backgroundDark: pick(
          "backgroundDark",
          "__",
          DEFAULT_THEME.backgroundDark,
        ),
        ...extras("Dark"),
      };
    }
    if (lightnessOf(light.background) < 0.5) {
      // The single saved pair was really a dark one — move it across and
      // derive the light side (extras included) from it.
      const derived = deriveLightPair(light);
      const darkExtras: Record<string, string> = {};
      for (const { key } of EXTRA_SLOTS) {
        const v = light[key as ExtraSlot];
        if (v) darkExtras[`${key}Dark`] = v;
      }
      return {
        ...derived,
        primaryDark: light.primary,
        backgroundDark: light.background,
        ...darkExtras,
      };
    }
    const derived = deriveDarkPair(light);
    const darkExtras: Record<string, string> = {};
    for (const { key } of EXTRA_SLOTS) {
      const v = derived[key];
      if (v) darkExtras[`${key}Dark`] = v;
    }
    return {
      ...light,
      primaryDark: derived.primary,
      backgroundDark: derived.background,
      ...darkExtras,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export function loadTheme(): CustomTheme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    return parseTheme(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(
  theme: CustomTheme,
  mode: ThemeMode = loadThemeMode(),
) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  applyTheme(theme, mode);
}

/** Clear any custom colours and fall back to the stylesheet's own tokens. */
export function resetTheme() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(CSS_KEY);
  localStorage.removeItem(ACTIVE_PROFILE_KEY);
  const root = document.documentElement;
  for (const name of THEMED_VARS) {
    root.style.removeProperty(name);
  }
  applyThemeMode(loadThemeMode());
}

/* ---------------------------------------------------------------------- */
/* Custom named theme profiles                                             */
/* ---------------------------------------------------------------------- */

const PROFILES_KEY = "app-theme-profiles";
const ACTIVE_PROFILE_KEY = "app-theme-active-profile";

export interface ThemeProfile {
  id: string;
  name: string;
  theme: CustomTheme;
  createdAt: number;
}

function readProfiles(): ThemeProfile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PROFILES_KEY);
    const parsed = raw ? (JSON.parse(raw) as ThemeProfile[]) : [];
    return Array.isArray(parsed)
      ? parsed.filter((p) => p && p.id && p.theme)
      : [];
  } catch {
    return [];
  }
}

function writeProfiles(profiles: ThemeProfile[]) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

export function listProfiles(): ThemeProfile[] {
  return readProfiles().sort((a, b) => a.createdAt - b.createdAt);
}

export function activeProfileId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_PROFILE_KEY);
  } catch {
    return null;
  }
}

export function setActiveProfile(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_PROFILE_KEY, id);
  else localStorage.removeItem(ACTIVE_PROFILE_KEY);
}

/** Create a named profile from a theme (name is trimmed and de-duplicated). */
export function createProfile(name: string, theme: CustomTheme): ThemeProfile {
  const profiles = readProfiles();
  const clean = name.trim() || "My theme";
  let unique = clean;
  let n = 2;
  while (profiles.some((p) => p.name.toLowerCase() === unique.toLowerCase())) {
    unique = `${clean} ${n++}`;
  }
  const profile: ThemeProfile = {
    id: `tp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: unique,
    theme,
    createdAt: Date.now(),
  };
  writeProfiles([...profiles, profile]);
  return profile;
}

/** Overwrite a profile's colours with the current theme. */
export function updateProfileTheme(id: string, theme: CustomTheme) {
  writeProfiles(readProfiles().map((p) => (p.id === id ? { ...p, theme } : p)));
}

export function renameProfile(id: string, name: string) {
  const clean = name.trim();
  if (!clean) return;
  writeProfiles(
    readProfiles().map((p) => (p.id === id ? { ...p, name: clean } : p)),
  );
}

export function deleteProfile(id: string) {
  writeProfiles(readProfiles().filter((p) => p.id !== id));
  if (activeProfileId() === id) setActiveProfile(null);
}

/** Re-apply a saved custom theme (also handled pre-paint by THEME_INIT_SCRIPT). */
export function initTheme() {
  if (typeof window === "undefined") return;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw) applyTheme(parseTheme(raw), loadThemeMode());
  else applyThemeMode(loadThemeMode());
}

/* ---------------------------------------------------------------------- */
/* Dark / light mode — separate from the custom accent-color engine above. */
/* Toggled from the Colours card and applied via a `.dark` class on        */
/* <html>, following Tailwind's class-based dark mode convention.         */
/* ---------------------------------------------------------------------- */

export type ThemeMode = "light" | "dark";

const MODE_STORAGE_KEY = "app-theme-mode";

/** Event fired whenever the light/dark mode changes, so open UI can follow. */
export const THEME_MODE_EVENT = "app-theme-mode-change";

/** Push "light"/"dark" onto <html class="..."> and persist it. */
export function applyThemeMode(mode: ThemeMode) {
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(THEME_MODE_EVENT, { detail: mode }));
}

export function loadThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "light";
  try {
    const raw = localStorage.getItem(MODE_STORAGE_KEY);
    return raw === "dark" || raw === "light" ? raw : "light";
  } catch {
    return "light";
  }
}

/**
 * Inline script injected into <head> (via __root.tsx's `scripts` array) so the
 * saved dark-mode class AND the saved custom colours are set before first
 * paint — no flash, and custom colours survive a reload.
 */
export const THEME_INIT_SCRIPT = `(function(){var m="light";try{m=localStorage.getItem("${MODE_STORAGE_KEY}")==="dark"?"dark":"light";if(m==="dark"){document.documentElement.classList.add("dark");}}catch(e){}try{var c=localStorage.getItem("${CSS_KEY}");if(c){var p=JSON.parse(c);var v=(p&&p[m])?p[m]:p;for(var k in v){if(typeof v[k]==="string"){document.documentElement.style.setProperty(k,v[k]);}}}}catch(e){}})();`;

/** React hook backing the light/dark switch inside the Colours card. */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => loadThemeMode());

  useEffect(() => {
    const sync = (e: Event) => {
      const mode = (e as CustomEvent<ThemeMode>).detail;
      if (mode === "light" || mode === "dark") setThemeState(mode);
    };
    window.addEventListener(THEME_MODE_EVENT, sync);
    return () => window.removeEventListener(THEME_MODE_EVENT, sync);
  }, []);

  const setTheme = (mode: ThemeMode) => {
    setThemeState(mode);
    // Each mode has its own saved colour pair, so switching simply re-resolves
    // the current theme for the new mode — no lightness guesswork.
    if (typeof window === "undefined") return;
    applyThemeMode(mode);
    // Prefer the cached CSS for this mode (no drift); fall back to a recompute.
    if (applyCachedMode(mode)) return;
    if (window.localStorage.getItem(STORAGE_KEY)) applyTheme(loadTheme(), mode);
  };

  return { theme, setTheme };
}
