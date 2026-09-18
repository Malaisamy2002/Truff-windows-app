import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  Hand,
  Lock,
  RotateCcw,
  Save,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";
import { useArrangeMode } from "@/lib/arrange-mode-context";
import { dayKey } from "@/lib/analytics";
import {
  LOCKED_TAB_ID,
  applyPreset,
  deletePreset,
  duplicatePreset,
  exportLayoutJson,
  importLayoutJson,
  presetNameTaken,
  renamePreset,
  resetLayoutToDefault,
  savePreset,
  setDensity,
  setTabVisible,
  tabLabel,
  updatePreset,
  usePresets,
  useLayoutPrefs,
} from "@/lib/layout-prefs";
import { cn } from "@/lib/utils";

/**
 * The slim bar that stays at the bottom while arrange mode is on.
 *
 * Holds everything that isn't attached to a single block: Done, tab
 * visibility, density, presets, reset and import/export. These controls moved
 * here verbatim from the old grey-box customizer dialog.
 */
export function ArrangeToolbar() {
  const { on, setOn, interactive, setInteractive } = useArrangeMode();
  const { layout, update } = useLayoutPrefs();
  const { presets, appliedId } = usePresets();
  const [saveOpen, setSaveOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Keep the bar from covering the last card on the page.
  useEffect(() => {
    if (!on) return;
    const prev = document.body.style.paddingBottom;
    document.body.style.paddingBottom = "13rem";
    return () => {
      document.body.style.paddingBottom = prev;
    };
  }, [on]);

  if (!on) return null;

  const tabs = layout.tabs.slice().sort((a, b) => a.order - b.order);
  const applied = presets.find((p) => p.id === appliedId) ?? null;

  const confirmSave = () => {
    const name = nameInput.trim();
    if (!name) return setNameError("Give this arrangement a name.");
    if (presetNameTaken(name))
      return setNameError("You already have a preset with that name.");
    savePreset(name, layout);
    setSaveOpen(false);
    toast.success(`Saved "${name}"`);
  };

  const confirmRename = () => {
    if (!applied) return;
    const name = nameInput.trim();
    if (!name) return setNameError("Give this arrangement a name.");
    if (presetNameTaken(name, applied.id))
      return setNameError("You already have a preset with that name.");
    renamePreset(applied.id, name);
    setRenameOpen(false);
    toast.success("Preset renamed");
  };

  const doExport = () => {
    const blob = new Blob([exportLayoutJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `layout-presets-${dayKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async (file: File) => {
    const text = await file.text();
    if (importLayoutJson(text)) toast.success("Layout imported");
    else toast.error("That file isn't a layout backup — nothing was changed.");
  };

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto max-w-3xl space-y-2 px-3 py-2">
          {/* Row 1 — finish + the two live switches */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setOn(false)}>
              <Check className="h-3.5 w-3.5" /> Done
            </Button>
            <Button
              size="sm"
              variant={interactive ? "default" : "outline"}
              onClick={() => setInteractive(!interactive)}
            >
              <Hand className="h-3.5 w-3.5" />{" "}
              {interactive ? "Taps on" : "Taps off"}
            </Button>
            <ToggleGroup
              type="single"
              value={layout.density}
              onValueChange={(v) =>
                v &&
                update((prev) =>
                  setDensity(prev, v as "comfortable" | "compact"),
                )
              }
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="comfortable">Comfortable</ToggleGroupItem>
              <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* Row 2 — tab visibility chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Tabs
            </span>
            {tabs.map((t) => {
              const locked = t.tabId === LOCKED_TAB_ID;
              return (
                <div
                  key={t.tabId}
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                    !t.visible && "border-dashed opacity-55",
                  )}
                >
                  <span>{tabLabel(t.tabId)}</span>
                  {locked ? (
                    <Lock
                      className="h-3 w-3 text-muted-foreground"
                      aria-label="Always on"
                    />
                  ) : (
                    <button
                      type="button"
                      aria-label={
                        t.visible
                          ? `Hide ${tabLabel(t.tabId)} tab`
                          : `Show ${tabLabel(t.tabId)} tab`
                      }
                      onClick={() =>
                        update((prev) =>
                          setTabVisible(prev, t.tabId, !t.visible),
                        )
                      }
                      className="text-muted-foreground"
                    >
                      {t.visible ? (
                        <Eye className="h-3 w-3" />
                      ) : (
                        <EyeOff className="h-3 w-3" />
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Row 3 — presets and backups */}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={appliedId ?? "__custom"}
              onValueChange={(v) => v !== "__custom" && applyPreset(v)}
            >
              <SelectTrigger className="h-8 w-[10.5rem]">
                <SelectValue placeholder="Custom" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__custom">Custom (unsaved)</SelectItem>
                {presets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setNameInput("");
                setNameError(null);
                setSaveOpen(true);
              }}
            >
              <Save className="h-3.5 w-3.5" /> Save as new
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!applied}
              onClick={() => {
                if (!applied) return;
                updatePreset(applied.id, layout);
                toast.success(`Updated "${applied.name}"`);
              }}
            >
              Update current
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!applied}
              onClick={() => {
                if (!applied) return;
                setNameInput(applied.name);
                setNameError(null);
                setRenameOpen(true);
              }}
            >
              Rename
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!applied}
              onClick={() => applied && duplicatePreset(applied.id)}
            >
              <Copy className="h-3.5 w-3.5" /> Duplicate
            </Button>
            {applied && (
              <ConfirmDeleteButton
                size="sm"
                ariaLabel={`Delete preset ${applied.name}`}
                title={`Delete "${applied.name}"?`}
                description="Your current arrangement stays exactly as it is — only the saved preset is removed."
                onConfirm={() => {
                  deletePreset(applied.id);
                  toast.success("Preset deleted");
                }}
              />
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                resetLayoutToDefault();
                toast.success("Layout reset to default");
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
            <Button size="sm" variant="ghost" onClick={doExport}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" /> Import
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void doImport(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this arrangement</DialogTitle>
            <DialogDescription>
              Saves the current tabs, sections and density under a name you can
              switch back to.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Preset name</Label>
            <Input
              value={nameInput}
              onChange={(e) => {
                setNameInput(e.target.value);
                setNameError(null);
              }}
              placeholder="My morning view"
              autoFocus
            />
            {nameError && (
              <p className="text-xs text-destructive">{nameError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmSave}>Save preset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename preset</DialogTitle>
            <DialogDescription>
              Choose a new name for this saved arrangement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Preset name</Label>
            <Input
              value={nameInput}
              onChange={(e) => {
                setNameInput(e.target.value);
                setNameError(null);
              }}
              autoFocus
            />
            {nameError && (
              <p className="text-xs text-destructive">{nameError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmRename}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
