import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { clearAllData } from "@/lib/devdata";

/** Settings → danger zone: a single irreversible "start over" button, gated
 * behind a warning dialog so it can never fire from one accidental tap. */
export function ClearAllDataCard() {
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const runClear = async () => {
    setBusy(true);
    try {
      await clearAllData();
      await qc.invalidateQueries();
      toast.success("All data cleared — starting fresh");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  return (
    <section className="space-y-3">
      <Card className="frost border-destructive/40">
        <CardContent className="space-y-3 p-4">
          <p className="text-sm text-muted-foreground">
            Permanently erases every customer, bill, booking, snack sale,
            expense, tab, saved receipt and setting on this device — a full
            reset back to a blank install. This cannot be undone from inside the
            app.
          </p>
          <Button
            variant="destructive"
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={() => setConfirmOpen(true)}
          >
            <AlertTriangle className="mr-2 h-4 w-4" /> Clear all data
          </Button>
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => !busy && setConfirmOpen(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Erase everything on this device?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every customer, bill, turf booking, snack
              sale, expense, customer tab, receipt and saved setting — not just
              test data. There is no undo. If you need to keep anything, cancel
              and take a backup first from <strong>Backup &amp; restore</strong>{" "}
              above.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void runClear();
              }}
            >
              {busy ? "Clearing…" : "Yes, delete everything"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
