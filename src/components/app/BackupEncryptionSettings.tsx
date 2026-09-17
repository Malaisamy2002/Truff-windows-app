import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Lock, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  readBackupPassphrase,
  writeBackupPassphrase,
} from "@/lib/backup-passphrase";

/**
 * The passphrase used to encrypt every backup archive before it leaves this
 * device (see `backup-crypto.ts`) — the single-file `.db` export
 * (`BackupCard`) as well as the Telegram/local full backup
 * (`TelegramBackupCard`). Both cards render this component, since either one
 * can be the first backup a person tries: `readBackupPassphrase`/
 * `writeBackupPassphrase` (backup-passphrase.ts) are the single source of
 * truth either way, so there's nothing to keep in sync between the two
 * copies. `onSaved` lets a card that only shows this conditionally (see
 * `BackupCard`) know to stop showing it once a passphrase exists.
 */
export function BackupEncryptionSettings({
  onSaved,
}: { onSaved?: () => void } = {}) {
  const [saved, setSaved] = useState(""); // what's actually stored, for the "set" check below
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const current = await readBackupPassphrase();
      setSaved(current);
      setValue(current);
      setLoaded(true);
    })();
  }, []);

  const dirty = loaded && value !== saved;

  const save = async () => {
    setBusy(true);
    try {
      await writeBackupPassphrase(value);
      setSaved(value);
      toast.success(
        value
          ? "Backup passphrase saved on this device"
          : "Backup passphrase cleared",
      );
      if (value) onSaved?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="frost">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="h-4 w-4" /> Backup encryption
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Every backup sent to Telegram (or saved locally) is encrypted with
          this passphrase before it leaves the device, so the ledger and receipt
          photos aren't readable by anyone who only has access to that chat or
          file. Use the same passphrase on every device that backs up or
          restores this ledger.
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={reveal ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                loaded && !saved
                  ? "Set a backup passphrase"
                  : "Backup passphrase"
              }
              className="pr-9"
            />
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-label={reveal ? "Hide passphrase" : "Show passphrase"}
            >
              {reveal ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          <Button disabled={!dirty || busy} onClick={() => void save()}>
            <Save className="mr-1 h-4 w-4" /> Save
          </Button>
        </div>
        {loaded && !saved && (
          <p className="text-xs text-destructive">
            No passphrase set yet — backups can't be sent until one is saved
            here.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          If this is lost, backups already sent can't be decrypted. Write it
          down somewhere safe.
        </p>
      </CardContent>
    </Card>
  );
}
