import { useCallback, useEffect, useState } from "react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import {
  Paintbrush,
  RotateCcw,
  Check,
  SlidersHorizontal,
  ChevronDown,
  Sun,
  Moon,
  Plus,
  Pencil,
  Trash2,
  Save,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DEFAULT_THEME,
  EXTRA_SLOTS,
  THEME_PRESETS,
  oklchToHex,
  activeProfileId,
  applyTheme,
  applyThemePreview,
  chromaOf,
  createProfile,
  deleteProfile,
  deriveDarkPair,
  deriveLightPair,
  lightnessOf,
  listProfiles,
  loadTheme,
  pairFor,
  renameProfile,
  resetTheme,
  saveTheme,
  themeToCssVars,
  setActiveProfile,
  updateProfileTheme,
  useTheme,
  withChroma,
  withLightness,
  withPair,
  type CustomTheme,
  type ExtraSlot,
  type PairPatch,
  type ThemeMode,
  type ThemePair,
  type ThemeProfile,
} from "@/lib/theme";

/**
 * The colour each optional slot falls back to when the owner has not picked
 * one — mirrors what themeToCssVars derives, so the wheel opens on the shade
 * that is actually on screen.
 */
function autoSlotHex(
  slot: ExtraSlot,
  pair: ThemePair,
  mode: ThemeMode,
): string {
  const dark = mode === "dark";
  const bgL = lightnessOf(pair.background);
  if (slot === "highlight") return oklchToHex(dark ? 0.7 : 0.6, 0.13, 165);
  if (slot === "surface") {
    return withLightness(
      pair.background,
      dark ? bgL + 0.05 : Math.min(0.995, bgL + 0.02),
    );
  }
  return withLightness(pair.background, dark ? bgL + 0.09 : bgL - 0.04);
}

/** A single "swatch button -> popover color wheel" control. */
function ColorSwatchPicker({
  label,
  hex,
  onChange,
}: {
  label: string;
  hex: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
      <Label className="truncate text-sm">{label}</Label>
      <div className="flex shrink-0 items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Pick ${label.toLowerCase()}`}
              className="h-8 w-8 shrink-0 rounded-md border shadow-xs"
              style={{ backgroundColor: hex }}
            />
          </PopoverTrigger>
          <PopoverContent className="w-auto space-y-2 p-3">
            <HexColorPicker color={hex} onChange={onChange} />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">#</span>
              <HexColorInput
                color={hex}
                // Half-typed / invalid hex keeps the previous colour instead of
                // falling through to black.
                onChange={(v) => {
                  if (/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim()))
                    onChange(v);
                }}
                className="h-8 w-24 rounded-md border bg-transparent px-2 text-xs uppercase"
                prefixed={false}
              />
            </div>
          </PopoverContent>
        </Popover>
        <span className="w-20 font-mono text-xs text-muted-foreground">
          {hex.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

/** Two-tone pill showing a theme's colours for the mode being edited. */
function ThemePill({
  name,
  theme,
  mode,
  active,
  onPick,
}: {
  name: string;
  theme: CustomTheme;
  mode: ThemeMode;
  active: boolean;
  onPick: () => void;
}) {
  const pair = pairFor(theme, mode);
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={`flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-xs font-medium transition-[box-shadow,transform] duration-200 hover:-translate-y-px hover:shadow-sm ${
        active ? "shadow-sm ring-2 ring-ring" : "shadow-xs"
      }`}
      style={{ backgroundColor: pair.background, color: pair.primary }}
    >
      <span
        className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/10"
        style={{ backgroundColor: pair.primary }}
      />
      <span className="truncate">{name}</span>
      {active && <Check className="h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}

/**
 * Small mock of the real app rendered in the mode being edited, using the
 * resolved tokens so it shows exactly what the app will look like.
 */
function ThemeMiniPreview({
  theme,
  mode,
}: {
  theme: CustomTheme;
  mode: ThemeMode;
}) {
  const vars = themeToCssVars(theme, mode) as Record<string, string>;
  const v = (name: string) => vars[name] ?? "";
  return (
    <div
      className="space-y-3 rounded-lg border p-3"
      style={{
        background: v("--background"),
        color: v("--foreground"),
        borderColor: v("--border"),
      }}
    >
      <div
        className="rounded-md border p-3"
        style={{ background: v("--card"), borderColor: v("--border") }}
      >
        <div
          className="text-[0.625rem] uppercase tracking-wider"
          style={{ color: v("--muted-foreground") }}
        >
          Collected today
        </div>
        <div className="stat-hero">₹12,450</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-md px-3 py-1.5 text-xs font-medium"
          style={{
            background: v("--primary"),
            color: v("--primary-foreground"),
          }}
        >
          Collect now
        </span>
        <span
          className="rounded-full px-2.5 py-1 text-xs"
          style={{ background: v("--muted"), color: v("--muted-foreground") }}
        >
          3 pending
        </span>
      </div>
      <div
        className="flex items-center justify-between rounded-md border px-3 py-2 text-xs"
        style={{ borderColor: v("--border") }}
      >
        <span>Slot 7–8 pm · Arun</span>
        <span className="font-mono">₹800</span>
      </div>
    </div>
  );
}

/** Compact saved-theme row: two-tone swatch, name, one overflow menu. */
function ProfileRow({
  profile,
  mode,
  active,
  onApply,
  onRename,
  onUpdate,
  onDelete,
}: {
  profile: ThemeProfile;
  mode: ThemeMode;
  active: boolean;
  onApply: () => void;
  onRename: () => void;
  onUpdate: () => void;
  onDelete: () => void;
}) {
  const pair = pairFor(profile.theme, mode);
  return (
    <div className="flex items-center gap-2 rounded-full border bg-background/40 px-2.5 py-1.5 shadow-xs transition-shadow duration-200 hover:shadow-sm">
      <button
        type="button"
        onClick={onApply}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <span
          className="h-6 w-6 shrink-0 overflow-hidden rounded-full border"
          style={{ backgroundColor: pair.background }}
        >
          <span
            className="block h-full w-1/2 rounded-l-full"
            style={{ backgroundColor: pair.primary }}
          />
        </span>
        <span className="truncate text-sm">{profile.name}</span>
        {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={`Options for ${profile.name}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onRename}>
            <Pencil className="mr-2 h-4 w-4" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onUpdate}>
            <Save className="mr-2 h-4 w-4" /> Update to current
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function sameTheme(a: CustomTheme, b: CustomTheme) {
  const same = (x?: string, y?: string) =>
    (x ?? "").toLowerCase() === (y ?? "").toLowerCase();
  for (const { key } of EXTRA_SLOTS) {
    if (!same(a[key], b[key])) return false;
    const darkKey = `${key}Dark` as keyof CustomTheme;
    if (
      !same(a[darkKey] as string | undefined, b[darkKey] as string | undefined)
    )
      return false;
  }
  return (
    same(a.primary, b.primary) &&
    same(a.background, b.background) &&
    same(a.primaryDark, b.primaryDark) &&
    same(a.backgroundDark, b.backgroundDark)
  );
}

export function ThemeCustomizerCard() {
  /** Light or dark — this is both the app mode and the pair being edited. */
  const { theme: mode, setTheme: setMode } = useTheme();
  /** Colours currently saved on this device. */
  const [saved, setSaved] = useState<CustomTheme>(DEFAULT_THEME);
  /** Colours being edited (previewed live, not yet committed). */
  const [draft, setDraft] = useState<CustomTheme>(DEFAULT_THEME);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [fineTune, setFineTune] = useState(false);

  /* Named profiles */
  const [profiles, setProfiles] = useState<ThemeProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<{
    mode: "create" | "rename";
    id?: string;
  } | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ThemeProfile | null>(null);

  const refreshProfiles = useCallback(() => {
    setProfiles(listProfiles());
    setActiveId(activeProfileId());
  }, []);

  useEffect(() => {
    const current = loadTheme();
    setSaved(current);
    setDraft(current);
    refreshProfiles();
  }, [refreshProfiles]);

  const pair = pairFor(draft, mode);

  /** Patch the pair for the mode currently being edited. */
  const update = (patch: PairPatch) => {
    const next = withPair(draft, mode, patch);
    setDraft(next);
    applyThemePreview(next, mode); // live preview, coalesced to one paint per frame
  };

  const setWholeTheme = (next: CustomTheme) => {
    setDraft(next);
    applyThemePreview(next, mode);
  };

  const dirty = !sameTheme(draft, saved);

  const commit = () => {
    saveTheme(draft, mode);
    setSaved(draft);
    setConfirmOpen(false);
    if (activeId) {
      updateProfileTheme(activeId, draft);
      refreshProfiles();
    }
    toast.success("Colours saved", {
      description: "They stay applied after a reload.",
    });
  };

  const discard = () => {
    setDraft(saved);
    applyTheme(saved, mode);
  };

  const handleReset = () => {
    resetTheme();
    setSaved(DEFAULT_THEME);
    setDraft(DEFAULT_THEME);
    setActiveProfile(null);
    setActiveId(null);
    applyTheme(DEFAULT_THEME, mode);
    toast.success("Default colours restored");
  };

  const isDefault = sameTheme(saved, DEFAULT_THEME);

  /** Copy the current mode's colours over to the other mode, auto-adjusted. */
  const matchOtherMode = () => {
    const otherMode = mode === "light" ? "dark" : "light";
    const otherPair =
      mode === "light" ? deriveDarkPair(pair) : deriveLightPair(pair);
    setWholeTheme(withPair(draft, otherMode, otherPair));
    toast.success(
      mode === "light" ? "Dark colours generated" : "Light colours generated",
    );
  };

  /* --- profile actions --- */
  const openCreate = () => {
    setNameValue("");
    setNameDialog({ mode: "create" });
  };

  const openRename = (p: ThemeProfile) => {
    setNameValue(p.name);
    setNameDialog({ mode: "rename", id: p.id });
  };

  const submitName = () => {
    if (!nameDialog) return;
    if (nameDialog.mode === "create") {
      const created = createProfile(nameValue, draft);
      setActiveProfile(created.id);
      saveTheme(draft, mode);
      setSaved(draft);
      refreshProfiles();
      toast.success(`Saved as "${created.name}"`);
    } else if (nameDialog.id) {
      renameProfile(nameDialog.id, nameValue);
      refreshProfiles();
      toast.success("Theme renamed");
    }
    setNameDialog(null);
  };

  const applyProfile = (p: ThemeProfile) => {
    setDraft(p.theme);
    setSaved(p.theme);
    saveTheme(p.theme, mode);
    setActiveProfile(p.id);
    setActiveId(p.id);
    toast.success(`"${p.name}" applied`);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteProfile(deleteTarget.id);
    refreshProfiles();
    toast.success(`"${deleteTarget.name}" deleted`);
    setDeleteTarget(null);
  };

  const bgLight = Math.round(lightnessOf(pair.background) * 100);
  const accentPunch = Math.round((chromaOf(pair.primary) / 0.32) * 100);

  const activeName =
    profiles.find((p) => p.id === activeId)?.name ??
    (dirty ? "Unsaved" : "Custom colours");

  return (
    <Card className="frost overflow-hidden rounded-3xl">
      <CardHeader className="gap-3 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Paintbrush className="h-4 w-4" /> Colours
            </CardTitle>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {activeName}
              {dirty ? " · unsaved changes" : ""}
            </p>
          </div>
          {/* Flips the app mode and the pair being edited, together. */}
          <div className="inline-flex shrink-0 rounded-full border bg-background/40 p-1">
            {(["light", "dark"] as ThemeMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  // setMode restores the cached CSS for that mode (no drift);
                  // only unsaved edits need a fresh preview pass.
                  setMode(m);
                  if (dirty) applyThemePreview(draft, m);
                }}
                aria-pressed={mode === m}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  mode === m
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {m === "light" ? (
                  <Sun className="h-3.5 w-3.5" />
                ) : (
                  <Moon className="h-3.5 w-3.5" />
                )}
                {m}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* 1 · One-tap themes */}
        <div className="space-y-3">
          <p className="stat-label text-muted-foreground">Presets</p>
          <div className="flex flex-wrap gap-2">
            {THEME_PRESETS.map((p) => (
              <ThemePill
                key={p.name}
                name={p.name}
                theme={p.theme}
                mode={mode}
                active={sameTheme(draft, p.theme)}
                onPick={() => {
                  setWholeTheme(p.theme);
                  setActiveProfile(null);
                  setActiveId(null);
                }}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Each preset carries its own light and dark colours, so both modes
            stay right.
          </p>
        </div>

        {/* Fine tune */}
        <Collapsible open={fineTune} onOpenChange={setFineTune}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-2xl border bg-background/40 px-4 py-3 text-left text-sm font-medium transition-[box-shadow,background-color] duration-200 hover:bg-accent hover:shadow-sm"
            >
              <span className="flex items-center gap-2.5">
                <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex flex-col items-start gap-0.5">
                  Fine tune
                  <span className="stat-label text-muted-foreground">
                    sliders &amp; slots
                  </span>
                </span>
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                  fineTune ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-3">
            <ColorSwatchPicker
              label="Accent colour"
              hex={pair.primary}
              onChange={(hex) => update({ primary: hex })}
            />
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Accent intensity</Label>
                <span className="font-mono text-xs text-muted-foreground">
                  {accentPunch}%
                </span>
              </div>
              <Slider
                value={[accentPunch]}
                min={0}
                max={110}
                step={1}
                aria-label="Accent intensity"
                onValueChange={([v = accentPunch]) =>
                  update({
                    primary: withChroma(pair.primary, (v / 100) * 0.32),
                  })
                }
              />
            </div>

            <ColorSwatchPicker
              label="Background colour"
              hex={pair.background}
              onChange={(hex) => update({ background: hex })}
            />
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Background brightness</Label>
                <span className="font-mono text-xs text-muted-foreground">
                  {bgLight}%
                </span>
              </div>
              <Slider
                value={[bgLight]}
                min={mode === "dark" ? 8 : 88}
                max={mode === "dark" ? 34 : 99}
                step={1}
                aria-label="Background brightness"
                onValueChange={([v = bgLight]) =>
                  update({
                    background: withLightness(pair.background, v / 100),
                  })
                }
              />
              <p className="text-xs text-muted-foreground">
                Kept inside a readable range for {mode} mode, so text and cards
                always stay legible.
              </p>
            </div>

            {/* Optional extra slots — each falls back to the auto-derived
                shade until the owner picks one, and "Auto" clears it again. */}
            <div className="space-y-4 border-t pt-4">
              {EXTRA_SLOTS.map(({ key, label, hint }) => {
                const set = pair[key];
                return (
                  <div key={key} className="space-y-1.5">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <ColorSwatchPicker
                          label={label}
                          hex={set ?? autoSlotHex(key, pair, mode)}
                          onChange={(hex) =>
                            update({ [key]: hex } as PairPatch)
                          }
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 shrink-0 px-2 text-xs"
                        disabled={!set}
                        onClick={() => update({ [key]: null } as PairPatch)}
                      >
                        Auto
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {hint}
                      {set ? "" : " · following the background automatically"}
                    </p>
                  </div>
                );
              })}
            </div>

            <Button variant="outline" size="sm" onClick={matchOtherMode}>
              Generate matching {mode === "light" ? "dark" : "light"} colours
            </Button>
          </CollapsibleContent>
        </Collapsible>

        {/* 3 · Preview — the app as it will look in the mode being edited */}
        <div className="space-y-2">
          <p className="stat-label text-muted-foreground">
            Preview · {mode} mode
          </p>
          <div className="rounded-2xl border bg-background/40 p-3 shadow-[inset_0_2px_10px_rgb(0_0_0/0.08)] sm:p-4">
            <ThemeMiniPreview theme={draft} mode={mode} />
          </div>
        </div>

        {/* 4 · My themes */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="stat-label text-muted-foreground">My themes</p>
            {dirty && (
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={openCreate}
              >
                <Plus className="mr-2 h-4 w-4" /> Save current as…
              </Button>
            )}
          </div>
          {profiles.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No saved themes yet. Tweak the colours, then save them under a
              name.
            </p>
          ) : (
            <div className="space-y-1.5">
              {profiles.map((p) => (
                <ProfileRow
                  key={p.id}
                  profile={p}
                  mode={mode}
                  active={p.id === activeId}
                  onApply={() => applyProfile(p)}
                  onRename={() => openRename(p)}
                  onUpdate={() => {
                    updateProfileTheme(p.id, draft);
                    saveTheme(draft, mode);
                    setSaved(draft);
                    refreshProfiles();
                    toast.success(`"${p.name}" updated`);
                  }}
                  onDelete={() => setDeleteTarget(p)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button
            size="lg"
            disabled={!dirty}
            onClick={() => setConfirmOpen(true)}
            className="rounded-full px-6 shadow-md"
          >
            <Check className="mr-2 h-4 w-4" /> Save colours
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!dirty}
            onClick={discard}
            className="text-muted-foreground"
          >
            Discard changes
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={isDefault && !dirty}
            className="text-muted-foreground"
          >
            <RotateCcw className="mr-2 h-4 w-4" /> Reset
          </Button>
        </div>
        {dirty && (
          <p className="text-xs text-muted-foreground">
            Previewing unsaved colours — save them to keep them after a reload.
          </p>
        )}

        {/* Name / rename a custom theme */}
        <Dialog
          open={nameDialog !== null}
          onOpenChange={(o) => !o && setNameDialog(null)}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>
                {nameDialog?.mode === "rename"
                  ? "Rename theme"
                  : "Name this theme"}
              </DialogTitle>
              <DialogDescription>
                {nameDialog?.mode === "rename"
                  ? "Give this saved theme a different name."
                  : "Save the current light + dark colours as your own named theme."}
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={nameValue}
              maxLength={40}
              placeholder="e.g. Evening counter"
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitName();
              }}
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setNameDialog(null)}>
                Cancel
              </Button>
              <Button onClick={submitName} disabled={!nameValue.trim()}>
                {nameDialog?.mode === "rename" ? "Rename" : "Save theme"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete a saved theme */}
        <AlertDialog
          open={deleteTarget !== null}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete "{deleteTarget?.name}"?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This only removes the saved theme. Your current colours stay as
                they are.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Apply these colours?</AlertDialogTitle>
              <AlertDialogDescription>
                The light and dark colours below will be used across the whole
                app on this device and kept after a reload. You can reset to the
                default theme any time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2 rounded-md border p-3 text-xs">
              {(["light", "dark"] as ThemeMode[]).map((m) => {
                const p = pairFor(draft, m);
                return (
                  <div key={m} className="flex items-center gap-4">
                    <span className="w-12 capitalize text-muted-foreground">
                      {m}
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className="h-6 w-6 rounded-md border"
                        style={{ backgroundColor: p.primary }}
                      />
                      <span className="font-mono">
                        {p.primary.toUpperCase()}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className="h-6 w-6 rounded-md border"
                        style={{ backgroundColor: p.background }}
                      />
                      <span className="font-mono">
                        {p.background.toUpperCase()}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={commit}>
                Save colours
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
