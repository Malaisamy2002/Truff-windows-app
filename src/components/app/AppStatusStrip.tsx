import { useEffect, useState } from "react";
import { Wifi, WifiOff, CloudUpload } from "lucide-react";
import { cn } from "@/lib/utils";
import { goToTab } from "@/lib/nav";
import {
  backupAgeLabel,
  backupReminderDue,
  useAppSettings,
} from "@/lib/settings";

/**
 * The always-visible status strip the app shell was missing (see
 * PROGRESS-NOTES.md — backup state previously lived only inside the
 * Settings tab's cards plus a one-time "Time for a backup" toast that's
 * easy to miss or dismiss). Two live facts, always on screen instead of
 * tucked away: whether the device is online right now, and how stale the
 * last backup is. Clicking the backup side jumps straight to Settings.
 *
 * Deliberately NOT a warning banner that only appears when something's
 * wrong — it's a quiet, permanent strip so "when did I last back up" is
 * always answerable at a glance, the same way a phone's status bar shows
 * signal/battery whether or not either is low.
 */
export function AppStatusStrip() {
  const { settings } = useAppSettings();
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const backupDue = backupReminderDue(settings);

  return (
    <div className="sticky top-[calc(4.25rem+env(safe-area-inset-top))] z-10 flex h-7 items-center justify-between gap-3 border-b bg-muted/40 px-4 text-[11px] text-muted-foreground backdrop-blur-md md:px-8">
      <span className="flex items-center gap-1.5">
        {online ? (
          <Wifi className="h-3 w-3 text-success" />
        ) : (
          <WifiOff className="h-3 w-3 text-destructive" />
        )}
        {online ? "Online" : "Offline — everything still saves locally"}
      </span>
      <button
        type="button"
        onClick={() => goToTab("settings")}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted",
          backupDue && "font-medium text-destructive",
        )}
        title="Open Settings → Backup & restore"
      >
        <CloudUpload className="h-3 w-3" />
        {backupAgeLabel(settings.lastBackupAt)}
      </button>
    </div>
  );
}
