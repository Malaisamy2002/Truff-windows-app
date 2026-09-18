import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Download, ShieldAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { shortDate } from "@/lib/biz";
import { useQueryClient } from "@tanstack/react-query";
import {
  backupSummary,
  buildBackup,
  decodeBackupBytes,
  downloadBackup,
  parseBackup,
  pickBackupFile,
  previewRestore,
  restoreBackup,
  type BackupFile,
  type BackupTable,
  type RestorePreview,
} from "@/lib/backup";
import { isAndroid, isDesktop } from "@/lib/desktop";
import { TABLE_LABELS } from "@/lib/backup-table-labels";
import { hasBackupPassphrase } from "@/lib/backup-passphrase";
import { BackupEncryptionSettings } from "./BackupEncryptionSettings";
import {
  useAppSettings,
  writeAppSettings,
  readAppSettings,
  type BackupReminder,
} from "@/lib/settings";

export function BackupCard() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [merge, setMerge] = useState(false);
  const [pending, setPending] = useState<{
    backup: BackupFile;
    mode: "merge" | "replace";
    preview: RestorePreview;
  } | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const { settings: appSettings, save: saveAppSettings } = useAppSettings();
  // `null` = still checking; `false` is what shows the inline encryption
  // setup below. Exports are encrypted unconditionally (downloadBackup ->
  // encryptFullBackupBytes), so a person who only ever uses this card — and
  // never opens the Telegram backup card, the other place this passphrase
  // can be set — needs a way to set one from right here too, not just a
  // toast error the first time they click Export.
  const [passphraseSet, setPassphraseSet] = useState<boolean | null>(null);

  useEffect(() => {
    void hasBackupPassphrase().then(setPassphraseSet);
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** Reads the file and computes what it would actually do, then always
   * surfaces the confirm dialog below — for merge as much as replace, since
   * "nothing to confirm" was itself misleading when a merge could still add
   * dozens of records the person hadn't seen listed anywhere. */
  const applyBackup = async (bytes: Uint8Array) => {
    const text = await decodeBackupBytes(bytes);
    const backup = parseBackup(text);
    const mode = merge ? "merge" : "replace";
    const preview = await previewRestore(backup, mode);
    setPending({ backup, mode, preview });
  };

  const confirmRestore = async () => {
    if (!pending) return;
    const { backup, mode } = pending;
    setPending(null);
    setShowDetails(false);
    setBusy("restore");
    try {
      const count = await restoreBackup(backup, mode);
      await qc.invalidateQueries();
      toast.success(`Restored ${count} records`, {
        description: backupSummary(backup),
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3">
      <Card className="frost">
        <CardHeader>
          <CardTitle className="text-base">Single-file backup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Exports every customer, bill, expense, booking and snack sale into
            one encrypted
            <code className="mx-1 rounded bg-muted px-1">.db</code> file you can
            keep or move to another device.
          </p>
          {passphraseSet === false && (
            <div className="frost-well space-y-2 rounded-xl p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                <ShieldAlert className="h-3.5 w-3.5" /> Set a backup passphrase
                before exporting
              </p>
              <BackupEncryptionSettings
                onSaved={() => setPassphraseSet(true)}
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy !== null}
              onClick={() =>
                run("export", async () => {
                  const backup = await buildBackup();
                  const savedTo = await downloadBackup(backup);
                  if (savedTo === null) return; // user cancelled the save dialog
                  writeAppSettings({
                    ...readAppSettings(),
                    lastBackupAt: new Date().toISOString(),
                  });
                  toast.success(
                    isDesktop() ? "Backup saved" : "Backup file downloaded",
                    {
                      description: backupSummary(backup),
                    },
                  );
                })
              }
            >
              <Download className="mr-1 h-4 w-4" /> Export .db file
            </Button>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => {
                // Android satisfies isDesktop() too, but pickBackupFile()'s
                // native open dialog (SAF picker) isn't implemented there —
                // fall through to the <input type="file"> below instead,
                // same as the browser/PWA build.
                if (isDesktop() && !isAndroid()) {
                  void run("import", async () => {
                    const bytes = await pickBackupFile();
                    if (bytes === null) return; // user cancelled the open dialog
                    await applyBackup(bytes);
                  });
                  return;
                }
                fileRef.current?.click();
              }}
            >
              <Upload className="mr-1 h-4 w-4" /> Import .db file
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".db,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void run("import", async () =>
                  applyBackup(new Uint8Array(await file.arrayBuffer())),
                );
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={merge} onCheckedChange={setMerge} />
            Merge with existing data (off = replace everything)
          </label>

          <div className="frost-well flex flex-wrap items-center justify-between gap-2 rounded-xl p-3">
            <div className="text-sm">
              <p className="micro-label">Backup reminders</p>
              <span className="block text-xs text-muted-foreground">
                {appSettings.lastBackupAt
                  ? `Last backup: ${shortDate(appSettings.lastBackupAt)}`
                  : "No backup downloaded yet on this device."}
              </span>
            </div>
            <div className="flex gap-2">
              {(["off", "daily", "weekly"] as BackupReminder[]).map((opt) => (
                <Button
                  key={opt}
                  size="sm"
                  variant={
                    appSettings.backupReminder === opt ? "default" : "outline"
                  }
                  onClick={() =>
                    saveAppSettings({ ...appSettings, backupReminder: opt })
                  }
                >
                  {opt === "off" ? "Off" : opt === "daily" ? "Daily" : "Weekly"}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={pending != null}
        onOpenChange={(o) => {
          if (!o) {
            setPending(null);
            setShowDetails(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.mode === "merge"
                ? "Add these records to this device?"
                : "Replace all data with this backup?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                {pending?.mode === "merge" ? (
                  <p>
                    This adds{" "}
                    <span className="font-medium text-foreground">
                      {pending.preview.totalAdded} new record
                      {pending.preview.totalAdded === 1 ? "" : "s"}
                    </span>{" "}
                    from the backup. The{" "}
                    {pending.preview.totalUnchangedOrRemoved} record
                    {pending.preview.totalUnchangedOrRemoved === 1
                      ? ""
                      : "s"}{" "}
                    already on this device are left exactly as they are —
                    nothing gets overwritten.
                  </p>
                ) : pending ? (
                  <p>
                    This deletes{" "}
                    <span className="font-medium text-foreground">
                      {pending.preview.totalUnchangedOrRemoved} record
                      {pending.preview.totalUnchangedOrRemoved === 1
                        ? ""
                        : "s"}{" "}
                      currently on this device
                    </span>{" "}
                    and replaces them with {pending.preview.totalAdded} from the
                    backup. This can't be undone. Turn on "Merge with existing
                    data" instead if you want to add these records without
                    deleting anything.
                  </p>
                ) : null}
                {pending && pending.preview.photoCount > 0 && (
                  <p>
                    Includes {pending.preview.photoCount} receipt photo
                    {pending.preview.photoCount === 1 ? "" : "s"}.
                  </p>
                )}
                {pending && (
                  <div>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs font-medium text-foreground underline-offset-2 hover:underline"
                      onClick={() => setShowDetails((v) => !v)}
                    >
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${showDetails ? "rotate-180" : ""}`}
                      />
                      {showDetails ? "Hide" : "Show"} table-by-table breakdown
                    </button>
                    {showDetails && (
                      <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2 text-xs">
                        {pending.preview.perTable
                          .filter((row) =>
                            row.mode === "merge"
                              ? row.added > 0 || row.alreadyPresent > 0
                              : row.willAdd > 0 || row.willRemove > 0,
                          )
                          .map((row) => (
                            <li
                              key={row.table}
                              className="flex justify-between gap-2"
                            >
                              <span>
                                {TABLE_LABELS[row.table] ?? row.table}
                              </span>
                              <span className="text-right">
                                {row.mode === "merge"
                                  ? `+${row.added} new · ${row.alreadyPresent} already have`
                                  : `+${row.willAdd} · −${row.willRemove}`}
                              </span>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmRestore();
              }}
              disabled={busy !== null}
            >
              {pending?.mode === "merge" ? "Add records" : "Replace everything"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
