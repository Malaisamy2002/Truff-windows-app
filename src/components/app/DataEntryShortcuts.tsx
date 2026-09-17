import { useEffect } from "react";
import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform ?? "");
const MOD = isMac ? "⌘" : "Ctrl";

const SHORTCUT_GROUPS: {
  section: string;
  items: { keys: string; label: string }[];
}[] = [
  {
    section: "Everywhere",
    items: [
      {
        keys: `${MOD} + K`,
        label:
          "Open the command palette (search, quick actions, jump to a tab)",
      },
      { keys: `${MOD} + Enter`, label: "Save / submit the current form" },
      {
        keys: "Alt + 1 … 8",
        label: "Jump straight to a tab (Home, Bookings, Sell, …)",
      },
      { keys: "/", label: "Jump to the search box on this page" },
      { keys: "Esc", label: "Close the open dialog" },
      { keys: "?", label: "Show this shortcuts list" },
    ],
  },
  {
    section: "Turf",
    items: [{ keys: `${MOD} + Enter`, label: "Save the booking" }],
  },
  {
    section: "Snacks",
    items: [
      {
        keys: "Enter (in Qty)",
        label: "Add the picked item to the cart, ready for the next",
      },
      { keys: `${MOD} + Enter`, label: "Generate the bill" },
    ],
  },
  {
    section: "Bills",
    items: [{ keys: "/", label: "Jump to Search customer or invoice no." }],
  },
  {
    section: "Money (Expenses)",
    items: [{ keys: `${MOD} + Enter`, label: "Add the expense" }],
  },
  {
    section: "Outstanding",
    items: [{ keys: "/", label: "Jump to Search name or phone" }],
  },
  {
    section: "Settings → Customer directory",
    items: [
      {
        keys: "/",
        label: "Jump to Search name or phone (section must be open)",
      },
    ],
  },
];

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Wires up app-wide data-entry shortcuts and renders the "?" help dialog
 * that documents them. Mount once near the root.
 *
 * - Ctrl/Cmd+Enter clicks whichever button on the current tab is marked
 *   `data-shortcut="save"` — each entry-heavy tab (Turf, Snacks, Expenses)
 *   tags its own primary Save/Add button with that attribute, so this stays
 *   correct without this component needing to know about any specific tab.
 * - "/" focuses whichever input on the current tab is marked
 *   `data-shortcut="search"` (Bills, Dues, Customers).
 * - Alt+1..Alt+9 jump directly to a tab, matching the header's tab order.
 * - "?" (outside of a text field) toggles a small reference dialog.
 */
export function DataEntryShortcuts({
  tabIds,
  onGoToTab,
  helpOpen,
  onHelpOpenChange,
}: {
  /** Tab ids in the same order as the header/bottom nav, so Alt+1 is the
   * first tab, Alt+2 the second, etc. */
  tabIds: readonly string[];
  onGoToTab: (id: string) => void;
  helpOpen: boolean;
  onHelpOpenChange: (open: boolean) => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        const btn = document.querySelector<HTMLButtonElement>(
          '[data-shortcut="save"]:not(:disabled)',
        );
        if (btn) {
          e.preventDefault();
          btn.click();
        }
        return;
      }

      if (e.altKey && /^[1-9]$/.test(e.key)) {
        const target = tabIds[Number(e.key) - 1];
        if (target) {
          e.preventDefault();
          onGoToTab(target);
        }
        return;
      }

      if (e.key === "/" && !isTypingTarget(e.target)) {
        const input = document.querySelector<HTMLInputElement>(
          '[data-shortcut="search"]',
        );
        if (input) {
          e.preventDefault();
          input.focus();
          input.select();
        }
        return;
      }

      if (e.key === "?" && !isTypingTarget(e.target)) {
        e.preventDefault();
        onHelpOpenChange(!helpOpen);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tabIds, onGoToTab, helpOpen, onHelpOpenChange]);

  return (
    <Dialog open={helpOpen} onOpenChange={onHelpOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-4" /> Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            Speed up data entry without reaching for the mouse.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {SHORTCUT_GROUPS.map((g) => (
            <div key={g.section} className="space-y-1.5">
              <p className="micro-label">{g.section}</p>
              <div className="space-y-1.5">
                {g.items.map((s) => (
                  <div
                    key={g.section + s.keys + s.label}
                    className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                  >
                    <span className="text-muted-foreground">{s.label}</span>
                    <kbd className="whitespace-nowrap rounded-md border bg-muted px-2 py-1 font-mono text-xs">
                      {s.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Small persistent button (bottom-left, out of the way of the scroll
 * button on the right) that opens the same shortcuts dialog on tap — the
 * discoverable path for anyone who wouldn't think to press "?". */
export function ShortcutsHintButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={onClick}
      title="Keyboard shortcuts (?)"
      aria-label="Keyboard shortcuts"
      className="frost fixed bottom-24 left-4 z-30 size-12 rounded-full shadow-lg md:bottom-6"
    >
      <Keyboard className="size-5" />
    </Button>
  );
}
