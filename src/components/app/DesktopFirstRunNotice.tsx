import { useEffect } from "react";
import { toast } from "sonner";
import { isAndroid, isDesktop } from "@/lib/desktop";

const SEEN_KEY = "ks:desktop-first-run-seen";

/**
 * First-run hint for the Windows desktop build.
 *
 * A person moving from the browser/PWA version has all their data in that
 * browser's IndexedDB — the desktop app has its own separate WebView2 data
 * store and starts empty. There is no automatic migration (see DESKTOP.md
 * → "Moving data from the web/PWA version"); the supported path is
 * Export .db file in the web app, then Import .db file here. This shows
 * that once, on the first desktop launch only, and never in the browser.
 */
export function DesktopFirstRunNotice() {
  useEffect(() => {
    if (!isDesktop() || isAndroid()) return;
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      return;
    }
    if (seen) return;
    const t = window.setTimeout(() => {
      toast.info("Already used this app in a browser?", {
        description:
          "Your existing data stays in that browser. Export a .db file there (Settings → Backup & restore → Export), then use Import .db file here to bring it across.",
        duration: 15000,
      });
      try {
        localStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* ignore */
      }
    }, 2000);
    return () => window.clearTimeout(t);
  }, []);

  return null;
}
