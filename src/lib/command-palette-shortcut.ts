import { useEffect } from "react";

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform ?? "");

export const MOD_LABEL = isMac ? "⌘K" : "Ctrl+K";

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
