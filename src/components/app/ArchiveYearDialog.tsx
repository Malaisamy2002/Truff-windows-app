import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Archive } from "lucide-react";
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
  archiveYear,
  isArchiveSkipped,
  skipArchiveForNow,
  yearDueForArchive,
  yearRowCount,
} from "@/lib/archive";
import { RETAINED_YEARS } from "@/lib/years";

/**
 * Watches for a year beyond the retention window and asks before archiving it.
 * Nothing is exported or deleted until the user confirms.
 */
export function ArchiveYearDialog() {
  const qc = useQueryClient();
  const [year, setYear] = useState<number | null>(null);
  const [rows, setRows] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const due = await yearDueForArchive();
      if (!alive || due == null || isArchiveSkipped(due)) return;
      setYear(due);
      setRows(await yearRowCount(due));
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const close = () => {
    if (year != null) skipArchiveForNow(year);
    setYear(null);
  };

  const run = async () => {
    if (year == null) return;
    setBusy(true);
    try {
      const res = await archiveYear(year);
      toast.success(`${res.year} archived`, {
        description: `${res.rows} records sent to Telegram and downloaded as “${res.fileName}”. Save the local copy in Documents → Turf bookings and sales.`,
      });
      qc.invalidateQueries();
      setYear(null);
    } catch (e) {
      toast.error("Archive failed — nothing was deleted", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog
      open={year != null}
      onOpenChange={(o) => (o ? undefined : close())}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Archive className="h-4 w-4" /> Archive {year} data?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The app keeps {RETAINED_YEARS} years of data. {year} has{" "}
            {rows.toLocaleString("en-IN")} records. On confirm they are sent to
            your configured Telegram chat and downloaded as “Turf bookings and
            sales - {year}.db” for your Documents folder, and only then removed
            from the app. If Telegram isn't set up yet, or either step fails,
            nothing is deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Not now</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void run();
            }}
            disabled={busy}
          >
            {busy ? "Archiving…" : "Archive & remove"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
