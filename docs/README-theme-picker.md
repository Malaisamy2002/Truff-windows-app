# Theme selector — millions of colors

Two files:

- `src/lib/theme.ts` — color math (hex ⇄ HSL), contrast-safe foreground text,
  and functions to apply/save/load/reset the theme.
- `src/components/app/ThemeCustomizerCard.tsx` — the Settings card itself:
  two color-wheel swatches (Accent, Background), a live preview, and Reset.

## 1. Install the color wheel dependency

```bash
npm install react-colorful
```

(~2.8kb, no other deps — this is what renders the actual HSL wheel with
unlimited color choice, not a fixed swatch grid.)

## 2. Confirm you have a `Popover` shadcn component

The card uses `@/components/ui/popover`. If it's not already in your project:

```bash
npx shadcn@latest add popover
```

(You already have `Card`, `Button`, and presumably `Label` from the rest of
the Settings page — same pattern as `ArchiveCard.tsx`.)

## 3. Drop the two files in

Copy `theme.ts` into `src/lib/` and `ThemeCustomizerCard.tsx` into
`src/components/app/` (or wherever your other Settings cards live).

## 4. Restore the saved theme on app start

In your top-level `App.tsx` (or `main.tsx`), call `initTheme()` once before
or on first render:

```tsx
import { initTheme } from "@/lib/theme";

// top of App.tsx, outside the component, or in a useEffect(() => initTheme(), [])
initTheme();
```

This re-applies whatever color the user last picked, so a refresh or app
restart doesn't reset to default.

## 5. Add the card to your Settings page

```tsx
import { ThemeCustomizerCard } from "@/components/app/ThemeCustomizerCard";

// alongside your other settings cards, e.g. next to ArchiveCard
<ThemeCustomizerCard />
```

## How it works

- The picked colors (hex) are stored in `localStorage` under `app-custom-theme`
  — one pair per mode (`primary`/`background` for light,
  `primaryDark`/`backgroundDark` for dark), plus optional `secondary`/
  `surface`/`highlight` slots per mode. Dark mode is tuned independently, not
  a dimmed copy of light.
- `themeToCssVars()` resolves a theme + mode into the design system's actual
  `oklch(...)` custom properties (this codebase's CSS variables are oklch,
  not HSL) — `contrastSafeAccent()` nudges the accent's lightness until it
  clears a minimum contrast ratio against its own auto-picked foreground, and
  the background is clamped into a sane lightness range per mode so a badly
  chosen color can never make text unreadable.
- `readableForeground()` picks near-black or near-white by an actual WCAG
  contrast-ratio comparison (not a lightness threshold), so pale yellows and
  mid greens don't end up with unreadable white text.
- **Resolved-CSS cache:** `applyTheme()` computes CSS vars for *both* modes
  in one call and caches them together under `app-custom-theme-css`.
  Switching modes calls `applyCachedMode()` first, which replays the cached
  values verbatim instead of re-running the color math — so light → dark →
  light returns byte-identical values instead of drifting by a few
  thousandths on each recompute. `THEME_INIT_SCRIPT` (injected before first
  paint) reads the same cache key, with a fallback to the whole cached blob
  for any theme saved before this dual-mode cache existed. Covered by
  `theme.test.ts`.
- Works identically in the web build and the Tauri desktop build — it's
  plain CSS variables + localStorage, nothing platform-specific.
