import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Database, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  readArchiveLog,
  yearRowCount,
  type ArchiveRecord,
} from "@/lib/archive";
import { formatDMY } from "@/lib/biz";
import { isDesktop } from "@/lib/desktop";
import { clearTestData } from "@/lib/devdata";
import { downloadReportPdf } from "@/lib/report-pdf";
import {
  clearVerificationData,
  runVerificationCheck,
  seedVerificationData,
  verificationPdfDoc,
} from "@/lib/verificationSeed";
import { currentYear, distinctYears, RETAINED_YEARS } from "@/lib/years";

/** Settings → year archive: status, manual archive, and a verification-data helper. */
export function ArchiveCard() {
  const qc = useQueryClient();
  const [years, setYears] = useState<number[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [pick, setPick] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<ArchiveRecord[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [verBusy, setVerBusy] = useState(false);

  const refresh = async () => {
    const list = await distinctYears();
    setYears(list);
    const map: Record<number, number> = {};
    for (const y of list) map[y] = await yearRowCount(y);
    setCounts(map);
    setLog(readArchiveLog());
    if (!pick && list.length) setPick(String(list[0]));
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runArchive = async () => {
    const year = Number(pick);
    if (!year) return;
    setConfirmArchive(false);
    setBusy(true);
    try {
      const res = await archiveYear(year);
      toast.success(`${res.year} archived`, {
        description: isDesktop()
          ? `${res.rows} records sent to Telegram and saved as “${res.fileName}”.`
          : `${res.rows} records sent to Telegram and downloaded as “${res.fileName}”.`,
      });
      qc.invalidateQueries();
      await refresh();
    } catch (e) {
      toast.error("Archive failed — nothing was deleted", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const runClear = async () => {
    setConfirmClear(false);
    setBusy(true);
    try {
      await clearTestData();
      toast.success("Bookings, snack sales and expenses cleared");
      qc.invalidateQueries();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const runSeedVerification = async () => {
    setVerBusy(true);
    try {
      const res = await seedVerificationData();
      toast.success("Verification data loaded", {
        description: `${res.bills} bills, ${res.bookings} bookings, ${res.sales} sales, ${res.expenses} expenses across Jul & Aug 2026 (GST 18% + 5% service enabled). Expected: Jul revenue ₹4,345, Aug ₹7,255 — matches scripts/verify-math.ts.`,
      });
      qc.invalidateQueries();
      await refresh();
    } finally {
      setVerBusy(false);
    }
  };

  const runClearVerification = async () => {
    setVerBusy(true);
    try {
      const res = await clearVerificationData();
      toast.success("Verification data cleared", {
        description: `${res.bills} bills, ${res.bookings} bookings, ${res.sales} sales, ${res.expenses} expenses removed.`,
      });
      qc.invalidateQueries();
      await refresh();
    } finally {
      setVerBusy(false);
    }
  };

  const runVerificationPdf = async () => {
    setVerBusy(true);
    try {
      const result = await runVerificationCheck();
      if (result.recordsFound === 0) {
        toast.error("No verification data loaded", {
          description:
            'Click "Load verification data (2 months)" first, then try again.',
        });
        return;
      }
      const saved = await downloadReportPdf(verificationPdfDoc(result));
      if (!saved) {
        toast.error("Could not save the verification PDF");
        return;
      }
      const passed = result.rows.filter((r) => r.pass).length;
      if (result.allPassed) {
        toast.success(`All ${result.rows.length} checks passed`, {
          description:
            "Hand-computed figures match the app exactly. PDF downloaded.",
        });
      } else {
        toast.error(
          `${result.rows.length - passed} of ${result.rows.length} checks FAILED`,
          {
            description:
              "See the downloaded PDF for exactly which figures don't match.",
          },
        );
      }
    } finally {
      setVerBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <Card className="frost">
        <CardContent className="space-y-4 p-4">
          <p className="text-sm text-muted-foreground">
            The app keeps {RETAINED_YEARS} years of data. When a{" "}
            {RETAINED_YEARS + 1}th year appears it asks to archive the oldest
            year: sent to your configured Telegram chat, then
            {isDesktop() ? " saved" : " downloaded"} as “Turf bookings and sales
            - YEAR.db”
            {isDesktop()
              ? " wherever you choose"
              : " for your Documents folder"}
            , and removed only after both succeed. Telegram backup must be set
            up first (Settings → Telegram backup).
          </p>

          <div className="space-y-1.5 text-sm">
            {years.length === 0 ? (
              <span className="text-muted-foreground">
                No dated records yet.
              </span>
            ) : (
              years.map((y) => (
                <div
                  key={y}
                  className="frost-soft lift flex justify-between rounded-xl border px-3 py-1.5"
                >
                  <span className="stat-value">{y}</span>
                  <span className="text-muted-foreground">
                    {(counts[y] ?? 0).toLocaleString("en-IN")} records
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={pick} onValueChange={setPick}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => setConfirmArchive(true)}
              disabled={busy || !pick}
            >
              Archive this year now
            </Button>
          </div>

          {log.length > 0 && (
            <div className="frost-well space-y-1 rounded-xl p-3 text-xs text-muted-foreground">
              <div className="micro-label text-foreground">Archived</div>
              {log.map((r) => (
                <div key={r.year}>
                  {r.year} · {r.rows.toLocaleString("en-IN")} records ·{" "}
                  {formatDMY(r.archived_at)} · {r.file_name}
                  {r.telegram_session ? " · sent to Telegram" : ""}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmClear(true)}
              disabled={busy}
            >
              Clear bookings, sales &amp; expenses
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runSeedVerification()}
              disabled={verBusy}
            >
              <Database className="mr-2 h-4 w-4" /> Load verification data (2
              months)
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void runClearVerification()}
              disabled={verBusy}
            >
              Clear verification data
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runVerificationPdf()}
              disabled={verBusy}
            >
              <FileDown className="mr-2 h-4 w-4" /> Verification results PDF
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Adds a small, hand-computed dataset across Jul–Aug 2026 (merged
            booking, cancelled booking, partial/unpaid bills, a month-boundary
            edge case, GST 18% + 5% service) so Dashboard and Reports totals can
            be checked by hand. "Verification results PDF" runs the app's real
            calculators against this data and downloads a PASS/FAIL table next
            to every hand-computed figure, so a mismatch is easy to spot without
            redoing any arithmetic. Tagged with a "VER-" prefix, so "Clear
            verification data" only removes these rows — nothing else.
          </p>
        </CardContent>

        <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive {pick || "this"} now?</AlertDialogTitle>
              <AlertDialogDescription>
                This sends {pick || "the selected year"}'s bookings, sales and
                expenses to your configured Telegram chat, downloads them as a
                separate local file, and only then permanently deletes that
                year's records from this device. This can't be undone from here
                — make sure Telegram is set up first, and that both the upload
                and download succeed before relying on it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  void runArchive();
                }}
                disabled={busy}
              >
                Archive now
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Clear bookings, sales &amp; expenses?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes all turf bookings, snack sales and
                expenses from this device — real records included, not just test
                data. This can't be undone. Make sure you have a backup first if
                you need to keep anything.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  void runClear();
                }}
                disabled={busy}
              >
                Delete everything
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Card>
    </section>
  );
}
