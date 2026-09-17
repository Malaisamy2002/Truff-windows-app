import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Gauge, FileDown, Trash2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  LOAD_TEST_MIXES,
  benchmarkPdfDoc,
  clearLoadTestData,
  countLoadTestRows,
  estimatedRows,
  loadTestYear,
  runLoadTestBenchmark,
  seedLoadTestData,
  type LoadTestBenchmark,
  type LoadTestCounts,
  type LoadTestMix,
  type SeedProgress,
} from "@/lib/loadtest";
import { downloadReportPdf } from "@/lib/report-pdf";

const fmt = (n: number) => n.toLocaleString("en-IN");

function CountLine({ counts }: { counts: LoadTestCounts }) {
  return (
    <p className="text-sm text-muted-foreground">
      Currently seeded: {fmt(counts.total)} rows — {fmt(counts.customers)}{" "}
      customers, {fmt(counts.snackItems)} snack items, {fmt(counts.bookings)}{" "}
      bookings, {fmt(counts.sales)} sales, {fmt(counts.bills)} bills,{" "}
      {fmt(counts.expenses)} expenses, {fmt(counts.stockHistory)} stock changes,{" "}
      {fmt(counts.tabEntries)} tab entries on {fmt(counts.tabs)} tabs.
    </p>
  );
}

/** Settings → Load test: seeds one realistic year of demo data (or removes it
 * again), and times how the app holds up on that dataset. Everything it writes
 * is tagged `lt-` / `LT-`, so removal touches exactly those rows and nothing
 * else. */
export function LoadTestCard() {
  const qc = useQueryClient();
  const year = loadTestYear();
  const [mix, setMix] = useState<LoadTestMix>("light");
  const [busy, setBusy] = useState<"seed" | "bench" | "pdf" | "remove" | null>(
    null,
  );
  const [progress, setProgress] = useState<SeedProgress | null>(null);
  const [counts, setCounts] = useState<LoadTestCounts | null>(null);
  const [result, setResult] = useState<LoadTestBenchmark | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const refreshCounts = () =>
    countLoadTestRows()
      .then(setCounts)
      .catch(() => {});
  useEffect(() => {
    void refreshCounts();
  }, []);

  const seeded = (counts?.total ?? 0) > 0;
  const est = estimatedRows(mix);

  const runSeed = async () => {
    setBusy("seed");
    setProgress({ month: 0, months: 12, rows: 0 });
    try {
      const r = await seedLoadTestData(mix, setProgress);
      await qc.invalidateQueries();
      refreshCounts();
      toast.success(`Seeded ${fmt(r.total)} rows for ${r.year}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const runBench = async () => {
    setBusy("bench");
    try {
      const r = await runLoadTestBenchmark();
      setResult(r);
      toast.success(`Benchmark done in ${fmt(r.totalMs)} ms`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const runPdf = async () => {
    if (!result) return;
    setBusy("pdf");
    try {
      await downloadReportPdf(benchmarkPdfDoc(result));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const runRemove = async () => {
    setBusy("remove");
    try {
      const removed = await clearLoadTestData();
      await qc.invalidateQueries();
      refreshCounts();
      setResult(null);
      toast.success(`Removed ${fmt(removed.total)} load-test rows`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      setConfirmRemove(false);
    }
  };

  return (
    <section className="space-y-3">
      <Card className="frost">
        <CardContent className="space-y-4 p-4">
          <p className="text-sm text-muted-foreground">
            Fills {year} with realistic demo data —{" "}
            {est.bookings.toLocaleString("en-IN")} turf bookings across the
            seven 11:30 AM–6:30 PM slots on 3 courts, snack sales that actually
            deplete stock, bills, expenses and a few moved-to-dues records — so
            you can try every screen under load. Everything is tagged and
            removable in one tap.
          </p>

          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1">
              <Label className="micro-label">Data mix</Label>
              <Select
                value={mix}
                onValueChange={(v) => setMix(v as LoadTestMix)}
                disabled={!!busy}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(LOAD_TEST_MIXES) as LoadTestMix[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {LOAD_TEST_MIXES[k].label} — ~
                      {fmt(estimatedRows(k).total)} rows
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => void runSeed()} disabled={!!busy}>
              <Play className="mr-2 h-4 w-4" />
              {busy === "seed"
                ? `Seeding month ${progress?.month ?? 1} of 12…`
                : seeded
                  ? "Re-seed one year"
                  : "Seed one year"}
            </Button>
          </div>

          {busy === "seed" && progress && (
            <div className="space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${Math.round((progress.month / progress.months) * 100)}%`,
                  }}
                />
              </div>
              <p className="micro-label text-muted-foreground">
                Writing month {progress.month} of {progress.months} —{" "}
                {fmt(progress.rows)} rows so far
              </p>
            </div>
          )}

          {counts && seeded && <CountLine counts={counts} />}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void runBench()}
              disabled={!!busy || !seeded}
            >
              <Gauge className="mr-2 h-4 w-4" />
              {busy === "bench" ? "Benchmarking…" : "Run benchmark"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void runPdf()}
              disabled={!!busy || !result}
            >
              <FileDown className="mr-2 h-4 w-4" />
              {busy === "pdf" ? "Saving…" : "Results PDF"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => setConfirmRemove(true)}
              disabled={!!busy || !seeded}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Remove load-test data
            </Button>
          </div>

          {result && (
            <div className="frost-soft space-y-1 rounded-xl border p-3 text-sm">
              <p className="font-medium">
                <FlaskConical className="mr-1 inline h-4 w-4" />
                Last run: {fmt(result.rows)} records in {fmt(result.totalMs)} ms
              </p>
              <p className="text-muted-foreground">
                Read {fmt(result.readMs)} ms · analytics{" "}
                {fmt(result.analyticsMs)} ms · PDF {fmt(result.pdfMs)} ms
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmRemove}
        onOpenChange={(open) => !busy && setConfirmRemove(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the load-test data?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the {counts ? fmt(counts.total) : ""} rows the load
              test wrote — customers, snack items, bookings, sales, bills,
              expenses, stock history and tab entries tagged{" "}
              <strong>LT-</strong>. Your own records are not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!busy}
              onClick={(e) => {
                e.preventDefault();
                void runRemove();
              }}
            >
              {busy === "remove" ? "Removing…" : "Yes, remove it"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
