import { useEffect, useState } from "react";
import {
  CalendarPlus,
  Cookie,
  Banknote,
  Wallet,
  Search,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform ?? "");
const MOD_LABEL = isMac ? "⌘K" : "Ctrl+K";

/**
 * After switching tabs, the destination tab's content is lazy-loaded, so its
 * `[data-shortcut="search"]` input isn't in the DOM yet on the same tick.
 * Poll briefly (a few animation frames, ~1s ceiling) rather than a fixed
 * `setTimeout` guess, then focus + select it the moment it appears.
 */
function focusSearchWhenReady(deadlineMs = 1000) {
  const start = performance.now();
  function tick() {
    const input = document.querySelector<HTMLInputElement>(
      '[data-shortcut="search"]',
    );
    if (input) {
      input.focus();
      input.select();
      return;
    }
    if (performance.now() - start < deadlineMs) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

type QuickAction = {
  id: string;
  label: string;
  hint: string;
  tab: string;
  icon: LucideIcon;
  focusSearch?: boolean;
};

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "new-booking",
    label: "New booking",
    hint: "Bookings",
    tab: "turf",
    icon: CalendarPlus,
  },
  {
    id: "sell-snacks",
    label: "Sell snacks",
    hint: "Sell",
    tab: "snacks",
    icon: Cookie,
  },
  {
    id: "collect-payment",
    label: "Collect payment",
    hint: "Outstanding",
    tab: "dues",
    icon: Banknote,
    focusSearch: true,
  },
  {
    id: "add-expense",
    label: "Add expense",
    hint: "Expenses",
    tab: "money",
    icon: Wallet,
  },
];

const FIND_ACTIONS: { id: string; label: string; tab: string }[] = [
  { id: "find-customer", label: "Find customer (name or phone)", tab: "dues" },
  { id: "find-invoice", label: "Find invoice", tab: "bills" },
];

export function CommandPalette({
  open,
  onOpenChange,
  navTabs,
  onGoToTab,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tabs in current nav order, respecting the owner's visibility settings. */
  navTabs: readonly { id: string; label: string }[];
  onGoToTab: (id: string) => void;
}) {
  const go = (tabId: string, alsoFocusSearch?: boolean) => {
    onOpenChange(false);
    onGoToTab(tabId);
    if (alsoFocusSearch) focusSearchWhenReady();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search for a tab…" />
      <CommandList>
        <CommandEmpty>No matching command.</CommandEmpty>
        <CommandGroup heading="Quick actions">
          {QUICK_ACTIONS.map((a) => (
            <CommandItem
              key={a.id}
              value={`${a.label} ${a.hint}`}
              onSelect={() => go(a.tab, a.focusSearch)}
            >
              <a.icon />
              <span>{a.label}</span>
              <CommandShortcut>{a.hint}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Find">
          {FIND_ACTIONS.map((a) => (
            <CommandItem
              key={a.id}
              value={a.label}
              onSelect={() => go(a.tab, true)}
            >
              <Search />
              <span>{a.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Go to">
          {navTabs.map((t) => (
            <CommandItem
              key={t.id}
              value={`Go to ${t.label}`}
              onSelect={() => go(t.id)}
            >
              <ArrowRight />
              <span>{t.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

/** Mount once near the root. Owns only the Ctrl/Cmd+K key binding — the
 * dialog's own open state still lives in the parent, same pattern as
 * `DataEntryShortcuts`' Esc-to-close being handled by the underlying Dialog
 * primitive rather than this hook. */
export function useCommandPaletteShortcut(onOpen: () => void) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpen();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);
}

export { MOD_LABEL };
