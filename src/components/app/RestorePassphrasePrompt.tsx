import { useState } from "react";
import { KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Fallback prompt for restoring a backup encrypted under a passphrase that
 * doesn't match the one currently stored on this device — a `.db`/archive
 * file from another device, or one made before this device's passphrase
 * was last changed in Settings → Backup encryption. `BackupCard` and
 * `TelegramBackupCard` open this only after decoding with the stored
 * passphrase has already thrown `WrongPassphraseError` or
 * `NoPassphraseSetError` (backup-crypto.ts); it never replaces that first,
 * automatic attempt. Submitting re-runs that same decode with the typed
 * passphrase; a second wrong guess reopens this same dialog rather than
 * dead-ending, since there's no way to tell "wrong file" from "wrong
 * passphrase" apart from trying again.
 */
export function RestorePassphrasePrompt({
  open,
  busy,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (passphrase: string) => void;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    if (!value || busy) return;
    onSubmit(value);
    setValue("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setValue("");
          onCancel();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Enter this file's passphrase
          </DialogTitle>
          <DialogDescription>
            This backup doesn't open with the passphrase saved on this device.
            Enter the passphrase it was created with — not necessarily this
            device's current one.
          </DialogDescription>
        </DialogHeader>
        <Input
          type="password"
          autoFocus
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Backup passphrase"
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={!value || busy} onClick={submit}>
            Unlock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
