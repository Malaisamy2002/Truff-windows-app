import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useArrangeMode } from "@/lib/arrange-mode-context";
import {
  orderedSections,
  usePresets,
  useLayoutPrefs,
} from "@/lib/layout-prefs";
import { SettingsActions } from "./SettingsField";

/**
 * Settings → Layout & arrangement.
 *
 * A short summary of the current arrangement plus the button that switches on
 * arrange mode: the app itself becomes the editor, so this leaves Settings and
 * drops you on the Home tab with every block framed.
 */
export function LayoutSettingsCard() {
  const { layout } = useLayoutPrefs();
  const { presets, appliedId } = usePresets();
  const { setOn } = useArrangeMode();

  const applied = presets.find((p) => p.id === appliedId) ?? null;
  const visibleTabs = layout.tabs.filter((t) => t.visible).length;
  const allSections = layout.tabs.flatMap((t) =>
    orderedSections(layout, t.tabId),
  );
  const visibleSections = allSections.filter((s) => s.visible).length;

  const start = () => {
    setOn(true);
    window.dispatchEvent(new CustomEvent("arrange:start"));
  };

  return (
    <Card className="frost">
      <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {applied ? applied.name : "Custom (unsaved)"}
          </p>
          <p className="text-xs leading-4 text-muted-foreground">
            {visibleTabs} of {layout.tabs.length} tabs · {visibleSections} of{" "}
            {allSections.length} sections ·{" "}
            {layout.density === "compact" ? "Compact" : "Comfortable"}
          </p>
        </div>
        <SettingsActions className="sm:shrink-0">
          <Button size="sm" onClick={start}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> Arrange this app
          </Button>
        </SettingsActions>
      </CardContent>
    </Card>
  );
}
