import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  CloudDownload,
  CloudUpload,
  HardDriveDownload,
  Pencil,
  QrCode,
  Save,
  ScanLine,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { isAndroid, isDesktop } from "@/lib/desktop";
import {
  DEFAULT_TELEGRAM_CONFIG,
  buildFullBackup,
  decodePairingPayload,
  defaultDeviceLabel,
  encodePairingPayload,
  fetchLatestFullBackupArchive,
  fullBackupFileName,
  isTelegramConfigured,
  pickFullBackupFile,
  previewFullBackup,
  readTelegramConfig,
  restoreFullBackup,
  restoreSummary,
  saveFullBackupLocally,
  uploadFullBackup,
  writeTelegramConfig,
  type FullBackupPreview,
  type TelegramConfig,
} from "@/lib/telegram-backup";
import { encryptFullBackupBytes } from "@/lib/backup-crypto";
import {
  SettingsActions,
  SettingsField,
  SettingsGrid,
  SettingsGroup,
  SettingsSwitchRow,
} from "./SettingsField";
import { BackupEncryptionSettings } from "./BackupEncryptionSettings";
import { TABLE_LABELS } from "./BackupCard";

const MAX_BOTS = 10;

/**
 * The one backup surface: build the combined archive (rows + receipt photos)
 * and send it to the person's own private Telegram chat, or save the exact
 * same archive to the device when they'd rather not set anything up.
 */
export function TelegramBackupCard() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [cfg, setCfg] = useState<TelegramConfig>(DEFAULT_TELEGRAM_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [merge, setMerge] = useState(false);
  const [pending, setPending] = useState<{
    bytes: Uint8Array;
    from: string;
    mode: "merge" | "replace";
    preview: FullBackupPreview;
  } | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Saved details live on this device only; read them after mount so server
  // and client render the same markup.
  useEffect(() => {
    void (async () => {
      const saved = await readTelegramConfig();
      setCfg({
        ...saved,
        deviceLabel: saved.deviceLabel || defaultDeviceLabel(),
      });
      setEditing(!isTelegramConfigured(saved));
      setLoaded(true);
    })();
  }, []);

  const configured = isTelegramConfigured(cfg);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const saveCfg = (next: TelegramConfig) => {
    setCfg(next);
    void writeTelegramConfig(next);
  };

  /** Reads the archive and computes what it would actually do — records and
   * receipt photos both — then always surfaces the confirm dialog below, for
   * merge as much as replace. A merge that silently added dozens of records
   * with nothing shown anywhere was itself the gap this closes: it matches
   * `BackupCard`'s single-file restore, which got the same treatment first. */
  const applyRestore = async (bytes: Uint8Array, from: string) => {
    const mode = merge ? "merge" : "replace";
    const preview = await previewFullBackup(bytes, mode);
    setPending({ bytes, from, mode, preview });
  };

  const confirmRestore = async () => {
    const job = pending;
    setPending(null);
    setShowDetails(false);
    if (!job) return;
    await run("restore", async () => {
      const result = await restoreFullBackup(job.bytes, job.mode);
      await qc.invalidateQueries();
      toast.success(`Restored from ${job.from}`, {
        description: restoreSummary(result),
      });
    });
  };

  const backupNow = () =>
    run("backup", async () => {
      setProgress("Packing everything into one file…");
      const { bytes: plainBytes, missingFiles } = await buildFullBackup(
        cfg.deviceLabel || defaultDeviceLabel(),
      );
      setProgress("Encrypting the backup…");
      const bytes = await encryptFullBackupBytes(plainBytes);
      const result = await uploadFullBackup(cfg, bytes, {
        deviceLabel: cfg.deviceLabel,
        onProgress: (p) =>
          setProgress(
            p.total === 1
              ? "Sending to Telegram…"
              : `Sending part ${p.part} of ${p.total}…`,
          ),
      });
      const notes = [
        `${result.parts} file${result.parts === 1 ? "" : "s"} sent`,
      ];
      if (missingFiles.length > 0)
        notes.push(
          `${missingFiles.length} receipt photo(s) weren't on this device`,
        );
      toast.success("Backup sent to your Telegram chat", {
        description: notes.join(" · "),
      });
    });

  const restoreLatest = () =>
    run("fetch", async () => {
      setProgress("Looking for the latest backup…");
      const { bytes } = await fetchLatestFullBackupArchive(cfg, (p) =>
        setProgress(
          p.total === 1
            ? "Downloading the backup…"
            : `Downloading part ${p.part} of ${p.total}…`,
        ),
      );
      await applyRestore(bytes, "Telegram");
    });

  const saveLocalCopy = () =>
    run("local-save", async () => {
      setProgress("Packing everything into one file…");
      const { bytes: plainBytes, missingFiles } = await buildFullBackup(
        cfg.deviceLabel || defaultDeviceLabel(),
      );
      setProgress("Encrypting the backup…");
      const bytes = await encryptFullBackupBytes(plainBytes);
      const savedTo = await saveFullBackupLocally(bytes, fullBackupFileName());
      if (savedTo === null) return; // cancelled
      toast.success(isDesktop() ? "Backup saved" : "Backup file downloaded", {
        description:
          missingFiles.length > 0
            ? `${missingFiles.length} receipt photo(s) weren't on this device`
            : "Records and receipt photos are both inside this one file.",
      });
    });

  const showQr = () =>
    run("qr", async () => {
      const QRCode = (await import("qrcode")).default;
      setQrDataUrl(
        await QRCode.toDataURL(encodePairingPayload(cfg), {
          width: 320,
          margin: 1,
        }),
      );
      setQrOpen(true);
    });

  const onScanned = (text: string) => {
    try {
      const payload = decodePairingPayload(text);
      saveCfg({
        ...cfg,
        botToken: payload.botToken,
        chatId: payload.chatId,
        extraBotTokens: payload.extraBotTokens ?? [],
      });
      setScanOpen(false);
      setEditing(false);
      toast.success("This device is now paired with the same Telegram chat");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <section className="space-y-3">
      <BackupEncryptionSettings />
      <Card className="frost">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="h-4 w-4" /> Telegram backup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            One backup with everything in it — every customer, bill, expense,
            booking, snack sale{" "}
            <span className="font-medium text-foreground">and</span> every
            receipt photo — sent to a private Telegram chat only you can see.
            Restoring brings all of it back in one go.
          </p>

          {!loaded ? (
            <p className="text-sm text-muted-foreground">
              Checking this device…
            </p>
          ) : editing ? (
            <>
              <SettingsGroup
                title="Connect Telegram"
                hint="Create a bot with @BotFather, add it to a private channel or group as an admin, then enter the details below."
              >
                <SettingsGrid>
                  <SettingsField label="Bot token" full>
                    <Input
                      type="password"
                      value={cfg.botToken}
                      onChange={(e) =>
                        saveCfg({ ...cfg, botToken: e.target.value.trim() })
                      }
                      placeholder="123456:ABC-DEF..."
                    />
                  </SettingsField>
                  <SettingsField
                    label="Chat ID"
                    hint="Usually starts with -100."
                  >
                    <Input
                      value={cfg.chatId}
                      onChange={(e) =>
                        saveCfg({ ...cfg, chatId: e.target.value.trim() })
                      }
                      placeholder="-1001234567890"
                    />
                  </SettingsField>
                  <SettingsField label="Name for this device">
                    <Input
                      value={cfg.deviceLabel}
                      onChange={(e) =>
                        saveCfg({ ...cfg, deviceLabel: e.target.value })
                      }
                      placeholder={defaultDeviceLabel()}
                    />
                  </SettingsField>
                </SettingsGrid>
              </SettingsGroup>

              <Separator />

              <SettingsGroup
                title="Large backups"
                hint={`Optional — spread large backups across up to ${MAX_BOTS} bots.`}
              >
                <div className="space-y-3">
                  {cfg.extraBotTokens.map((token, i) => (
                    <SettingsField
                      key={i}
                      label={`Extra bot ${i + 2}`}
                      reserveHint={false}
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                        <Input
                          type="password"
                          value={token}
                          onChange={(e) => {
                            const next = [...cfg.extraBotTokens];
                            next[i] = e.target.value.trim();
                            saveCfg({ ...cfg, extraBotTokens: next });
                          }}
                          placeholder="234567:GHI-JKL..."
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove bot ${i + 2}`}
                          onClick={() =>
                            saveCfg({
                              ...cfg,
                              extraBotTokens: cfg.extraBotTokens.filter(
                                (_, j) => j !== i,
                              ),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </SettingsField>
                  ))}
                  <SettingsActions>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={cfg.extraBotTokens.length >= MAX_BOTS - 1}
                      onClick={() =>
                        saveCfg({
                          ...cfg,
                          extraBotTokens: [...cfg.extraBotTokens, ""],
                        })
                      }
                    >
                      <Plus className="mr-1 h-4 w-4" /> Add another bot
                    </Button>
                  </SettingsActions>
                  <p className="text-xs text-muted-foreground">
                    {cfg.extraBotTokens.length + 1} of {MAX_BOTS} bots in use
                    {cfg.extraBotTokens.length >= MAX_BOTS - 1
                      ? " — that's the maximum."
                      : ""}
                  </p>
                </div>
              </SettingsGroup>

              <Separator />

              <SettingsGroup title="Save and pair">
                <SettingsActions>
                  <Button
                    disabled={!isTelegramConfigured(cfg) || busy !== null}
                    onClick={() =>
                      run("save", async () => {
                        await writeTelegramConfig(cfg);
                        setEditing(false);
                        toast.success(
                          isDesktop() && !isAndroid()
                            ? "Saved — the bot token is kept in Windows Credential Manager"
                            : "Saved on this device",
                        );
                      })
                    }
                  >
                    <Save className="mr-1 h-4 w-4" /> Save details
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => setScanOpen(true)}
                  >
                    <ScanLine className="mr-1 h-4 w-4" /> Scan setup QR
                  </Button>
                  {configured && (
                    <Button variant="ghost" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                  )}
                </SettingsActions>
                <p className="text-xs text-muted-foreground">
                  The bot token never leaves this device. Keep the chat private
                  — anyone in it can read your backups.
                </p>
              </SettingsGroup>
            </>
          ) : (
            <>
              <div className="frost-well flex items-start justify-between gap-3 rounded-xl p-3">
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium">Chat {cfg.chatId}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    This device: {cfg.deviceLabel || defaultDeviceLabel()}
                    {cfg.extraBotTokens.length > 0
                      ? ` · ${cfg.extraBotTokens.length + 1} bots`
                      : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                </Button>
              </div>

              <SettingsActions>
                <Button disabled={busy !== null} onClick={backupNow}>
                  <CloudUpload className="mr-1 h-4 w-4" /> Backup now
                </Button>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={restoreLatest}
                >
                  <CloudDownload className="mr-1 h-4 w-4" /> Restore latest
                </Button>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={showQr}
                >
                  <QrCode className="mr-1 h-4 w-4" /> Show setup QR
                </Button>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => setScanOpen(true)}
                >
                  <ScanLine className="mr-1 h-4 w-4" /> Scan setup QR
                </Button>
              </SettingsActions>

              <SettingsSwitchRow
                label="Merge with what's already here"
                hint="When off, restoring replaces everything on this device."
                checked={merge}
                onCheckedChange={setMerge}
              />
            </>
          )}

          {progress && (
            <p className="text-xs text-muted-foreground">{progress}</p>
          )}

          <div className="frost-well space-y-2 rounded-xl p-3">
            <p className="text-xs text-muted-foreground">
              No Telegram? You can{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                disabled={busy !== null}
                onClick={saveLocalCopy}
              >
                save a local copy instead
              </button>{" "}
              — the very same file, kept on this device.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => {
                if (isDesktop() && !isAndroid()) {
                  void run("local-open", async () => {
                    const bytes = await pickFullBackupFile();
                    if (bytes === null) return;
                    await applyRestore(bytes, "this device");
                  });
                  return;
                }
                fileRef.current?.click();
              }}
            >
              <HardDriveDownload className="mr-1 h-3.5 w-3.5" /> Restore from a
              saved file
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void run("local-open", async () =>
                  applyRestore(
                    new Uint8Array(await file.arrayBuffer()),
                    "this device",
                  ),
                );
              }}
            />
          </div>

          <Collapsible open={helpOpen} onOpenChange={setHelpOpen}>
            <CollapsibleTrigger className="text-xs underline underline-offset-2 text-muted-foreground">
              How do I set this up?
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <ol className="space-y-1 text-xs text-muted-foreground">
                <li>
                  1. In Telegram, message @BotFather and send /newbot to get a
                  bot token.
                </li>
                <li>
                  2. Make a private channel or group and add your bot to it as
                  an admin that can post.
                </li>
                <li>
                  3. Send any message there, then paste that chat ID here (it
                  usually starts with -100).
                </li>
                <li>
                  4. Tap "Backup now" — records and receipt photos go over as
                  one file.
                </li>
                <li>
                  5. On a second device, tap "Scan setup QR" and point it at the
                  first device's "Show setup QR", then tap "Restore latest".
                </li>
              </ol>
              <p className="pt-1 text-xs text-muted-foreground">
                Keep the chat private — anyone in it can read your backups. The
                bot token stays on this device.
              </p>
            </CollapsibleContent>
          </Collapsible>
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
                : "Replace everything with this backup?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                {pending?.mode === "merge" ? (
                  <p>
                    This adds{" "}
                    <span className="font-medium text-foreground">
                      {pending.preview.tables.totalAdded} new record
                      {pending.preview.tables.totalAdded === 1 ? "" : "s"}
                    </span>{" "}
                    from {pending.from}. The{" "}
                    {pending.preview.tables.totalUnchangedOrRemoved} record
                    {pending.preview.tables.totalUnchangedOrRemoved === 1
                      ? ""
                      : "s"}{" "}
                    already on this device are left exactly as they are —
                    nothing gets overwritten.
                  </p>
                ) : pending ? (
                  <p>
                    This deletes{" "}
                    <span className="font-medium text-foreground">
                      {pending.preview.tables.totalUnchangedOrRemoved} record
                      {pending.preview.tables.totalUnchangedOrRemoved === 1
                        ? ""
                        : "s"}{" "}
                      currently on this device
                    </span>{" "}
                    and replaces them with {pending.preview.tables.totalAdded}{" "}
                    from {pending.from}. It can't be undone — turn on "Merge
                    with what's already here" first if you'd rather add to it.
                  </p>
                ) : null}
                {pending && pending.preview.filesToAdd > 0 && (
                  <p>
                    Includes {pending.preview.filesToAdd} receipt photo
                    {pending.preview.filesToAdd === 1 ? "" : "s"}
                    {pending.preview.filesSkippedExisting > 0 ? (
                      <>
                        {" "}
                        ({pending.preview.filesSkippedExisting} already saved
                        here, left alone)
                      </>
                    ) : null}
                    .
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
                        {pending.preview.tables.perTable
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

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Scan this on the other device</DialogTitle>
          </DialogHeader>
          {qrDataUrl && (
            <img
              src={qrDataUrl}
              alt="Telegram backup setup code"
              className="mx-auto rounded-lg"
            />
          )}
          <p className="text-xs text-muted-foreground">
            Open Settings → Telegram backup there and tap "Scan setup QR". Only
            show this to devices you own — it carries the bot token.
          </p>
        </DialogContent>
      </Dialog>

      <QrScannerDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onResult={onScanned}
      />
    </section>
  );
}

/** Camera QR reader — decodes frames with jsQR, closes on the first hit. */
function QrScannerDialog({
  open,
  onOpenChange,
  onResult,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResult: (text: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let frame = 0;
    let cancelled = false;
    setError(null);

    void (async () => {
      try {
        const jsQR = (await import("jsqr")).default;
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        const tick = () => {
          if (cancelled || !ctx) return;
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const found = jsQR(image.data, image.width, image.height);
            if (found?.data) {
              onResult(found.data);
              return;
            }
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch {
        setError(
          "This device wouldn't share its camera. Type the details in instead.",
        );
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, onResult]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Point the camera at the setup code</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full rounded-lg bg-muted"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
