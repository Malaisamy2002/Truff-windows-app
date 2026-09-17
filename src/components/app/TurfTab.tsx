import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  CheckCircle2,
  Eye,
  FileDown,
  Printer,
  Download,
  ChevronLeft,
  ChevronRight,
  Trophy,
  AlertCircle,
  ListChecks,
  NotebookPen,
  Trash2,
  Pencil,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { exportToExcel } from "@/lib/xlsx";
import { INVOICE_SECTIONS } from "@/lib/desktop";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ListDisclosure } from "./ListDisclosure";
import { SectionHeading } from "@/components/app/SectionHeading";
import {
  LayoutSection,
  LayoutSections,
  LayoutPart,
  LayoutParts,
} from "./LayoutSection";
import { bookingGrossTotal, formatDMY, money } from "@/lib/biz";
import { rupees } from "@/lib/money";
import {
  bookingCashCollected,
  bookingDue,
  bookingMovedToDues,
  bookingStateLabel,
  dueNoForRef,
  isFinancialBooking,
  netTabAmountFor,
} from "@/lib/dues";
import { Badge } from "@/components/ui/badge";
import { useBills } from "@/lib/data";
import { cn, localDateStr } from "@/lib/utils";
import { useSaveCustomer } from "@/lib/data";
import {
  compareBy,
  sortSuffix,
  useSortState,
  type SortOption,
} from "@/lib/sort";
import {
  TAB_REF_TURF_BOOKING,
  useAddTabEntry,
  useTabEntries,
} from "@/lib/tabs";
import { SortMenu } from "./SortMenu";
import {
  minuteLabel,
  hoursLabel,
  parseMinutes,
  DAY_PARTS,
  type DayPartId,
} from "./TimeSlotPicker";
import { TurfCalendarCard } from "./TurfCalendarCard";
import { BookingWizard, type BookingFormState } from "./BookingWizard";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";
import { bookingReceipt, printReceipt, downloadReceipt } from "@/lib/receipt";
import { RecordActionRow } from "./RecordActionRow";
import { usePrintSettings } from "@/lib/print";
import {
  derivePaymentState,
  paymentStateLabel,
  paymentStateBadgeClass,
} from "@/lib/payment-status";
import { usePrintPreview } from "./PrintPreviewDialog";
import {
  BOOKING_STATUSES,
  PAYMENT_MODES,
  useCreateTurfBooking,
  useDeleteTurfBooking,
  useTurfBookings,
  useTurfRates,
  useUpdateTurfBooking,
  rateForInterval,
  allowedIntervalsFor,
  useSlotDurations,
  priceForDuration,
  type TurfBooking,
} from "@/lib/ops";

const today = () => localDateStr();

const defaultDayPart = (): DayPartId => {
  const h = new Date().getHours();
  if (h < 6) return "latenight";
  if (h < 12) return "morning";
  if (h < 16) return "afternoon";
  if (h < 20) return "evening";
  return "night";
};

/**
 * Peak-hour pricing: matches an existing slot-rate name to the chosen day part
 * and date. Evening/night/late-night count as "peak", morning/afternoon as
 * "off peak", and weekend/weekday names match the calendar date.
 */
const pickRateForContext = (
  names: string[],
  dayPart: DayPartId,
  date: string,
) => {
  const isWeekend = [0, 6].includes(new Date(`${date}T00:00:00`).getDay());
  const peak =
    dayPart === "evening" || dayPart === "night" || dayPart === "latenight";
  const wanted = [
    dayPart,
    peak ? "peak" : "off",
    isWeekend ? "weekend" : "weekday",
  ];
  for (const want of wanted) {
    const hit = names.find((n) => {
      const low = n.toLowerCase();
      if (want === "peak" && low.includes("off")) return false; // "Off Peak" isn't peak
      return low.includes(want);
    });
    if (hit) return hit;
  }
  return null;
};

/** Which DAY_PARTS bucket a minutes-from-midnight value falls into — used to
 * put the wizard's slot grid on the right day part when editing a booking
 * whose start time isn't in the currently-selected day part. */
const dayPartForMinute = (m: number): DayPartId => {
  const clamped = ((m % 1440) + 1440) % 1440;
  const part = DAY_PARTS.find(
    (p) => clamped >= p.from * 60 && clamped < p.to * 60,
  );
  return part ? part.id : "morning";
};

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDateStr(d);
};

type BookingSortField = "date" | "customer" | "slot" | "amount";

const BOOKING_SORT_OPTIONS: SortOption<BookingSortField>[] = [
  { value: "date", label: "Date", defaultDir: "desc" },
  { value: "customer", label: "Customer", defaultDir: "asc" },
  { value: "slot", label: "Slot", defaultDir: "asc" },
  { value: "amount", label: "Amount", defaultDir: "desc" },
];

type DuesSortField = "date" | "amount";

const DUES_SORT_OPTIONS: SortOption<DuesSortField>[] = [
  { value: "date", label: "Due date", defaultDir: "asc" },
  { value: "amount", label: "Amount due", defaultDir: "desc" },
];

type TurfTabProps = {
  /**
   * Set by the Customers tab's "New booking" row action (via `goToTab` in
   * `lib/nav.ts`) — name/phone to drop straight into a fresh booking's
   * Customer step. `null`/absent means no hand-off is pending.
   */
  prefillCustomer?: { name: string; phone: string | null } | null;
  /** Called once the prefill above has been applied, so the caller (routes/
   * index.tsx) can clear it and a later tab switch doesn't reapply it. */
  onConsumePrefillCustomer?: () => void;
};

export function TurfTab({
  prefillCustomer,
  onConsumePrefillCustomer,
}: TurfTabProps = {}) {
  const { data: rates = [] } = useTurfRates();
  const { data: bookings = [] } = useTurfBookings();
  const create = useCreateTurfBooking();
  const { settings: printSettings } = usePrintSettings();
  const { openPreview, previewDialog } = usePrintPreview();
  const update = useUpdateTurfBooking();
  const addTabEntry = useAddTabEntry();
  const del = useDeleteTurfBooking();
  const isMobile = useIsMobile();
  /** Right-click ("Delete") goes through this confirm dialog rather than
   * mutating straight away, same gate the row's own `ConfirmDeleteButton`
   * uses — a context menu selection is just as easy to mis-click as a
   * stray tap. */
  const [deleteTarget, setDeleteTarget] = useState<TurfBooking | null>(null);
  const saveCustomer = useSaveCustomer();
  /** Selected booking for the desktop two-pane list/detail split below —
   * same pattern as Bills' `activeBillId`/Customers' `openCustomer`. Not
   * reset when the selected booking falls off the current page/date filter
   * — `activeBooking` below just resolves to null and the right pane shows
   * the empty state, exactly like Bills. */
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);

  const activeRates = rates.filter((r) => r.is_active);

  const [form, setForm] = useState<BookingFormState>({
    booking_date: today(),
    customer_name: "",
    phone: "",
    slot_name: "",
    advance_paid: "",
    payment_mode: "Cash",
    status: "Confirmed",
  });
  const [bookingStep, setBookingStep] = useState<1 | 2 | 3 | 4>(1);
  const [courts, setCourts] = useState(1);
  const [dayPart, setDayPart] = useState<DayPartId>(defaultDayPart());
  const [interval, setInterval] = useState<number>(60);
  const [selectedSlots, setSelectedSlots] = useState<number[]>([]);
  // Set while reschedule-editing an existing booking (see startEdit/cancelEdit
  // below); null means the wizard is in its normal "new booking" mode.
  const [editingId, setEditingId] = useState<string | null>(null);

  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");

  const [repeatWeeks, setRepeatWeeks] = useState(1);
  const [collect, setCollect] = useState<Record<string, string>>({});

  /**
   * Every minute already covered by a non-cancelled booking on `date`.
   *
   * Bookings are stored as a start time + duration, so a late-night booking
   * can run past midnight (e.g. 23:00 + 2 h). Those spill-over minutes belong
   * to the FOLLOWING calendar day, so the previous day's bookings have to be
   * checked too or the early hours of `date` look free and get double-booked.
   */
  const occupiedMinutesOn = useMemo(() => {
    const prevDay = (date: string) => {
      const d = new Date(`${date}T00:00:00`);
      if (Number.isNaN(d.getTime())) return null;
      d.setDate(d.getDate() - 1);
      // Local calendar day — toISOString() renders UTC, which for IST turned
      // "one day back" into TWO days back (10 Mar asked for 8 Mar), so a
      // late-night spill-over from the real previous day was never seen and
      // could be double-booked.
      return localDateStr(d);
    };

    // excludeId: the booking currently being edited shouldn't block its own
    // slot — otherwise re-opening a booking to reschedule it would show its
    // own current time as "taken" and refuse to let it be re-selected.
    return (date: string, excludeId?: string | null) => {
      // minute -> number of courts already in use at that minute
      const occupied = new Map<number, number>();
      const use = (m: number) =>
        occupied.set(m, (occupied.get(m) ?? 0) + (b_courts ?? 1));
      let b_courts = 1;
      const yesterday = prevDay(date);
      for (const b of bookings) {
        if (b.status === "Cancelled") continue;
        if (excludeId && b.id === excludeId) continue;
        const sameDay = b.booking_date === date;
        const dayBefore = yesterday !== null && b.booking_date === yesterday;
        if (!sameDay && !dayBefore) continue;
        const start = parseMinutes(b.start_time);
        if (start === null) continue;
        const span = Math.max(1, Math.round((b.hours || 1) * 60));
        b_courts = Math.max(1, Number(b.courts ?? 1));
        for (let m = start; m < start + span; m++) {
          // Same-day booking: only the minutes before midnight land on `date`.
          if (sameDay && m < 1440) use(m);
          // Previous-day booking: only the minutes past midnight land on `date`.
          if (dayBefore && m >= 1440) use(m - 1440);
        }
      }
      return occupied;
    };
  }, [bookings]);

  // Slot durations + court count switched on globally in Settings → Turf rates.
  const { data: slotDurations } = useSlotDurations();
  const totalCourts = Math.max(1, Number(slotDurations?.total_courts ?? 1));

  /**
   * Slot-grid marks (in the currently selected `interval`) that overlap an
   * existing booking on `date` — including one made under a *different*
   * interval setting. A booking is stored as an exact start time + duration,
   * so e.g. a 45-min booking starting at 6:45 must still block the 6:00–7:00
   * and 7:00–8:00 hourly slots. Comparing raw start-minute values missed this
   * whenever the grids didn't line up, letting the same time get booked twice.
   */
  const takenOn = useMemo(() => {
    return (date: string, excludeId?: string | null) => {
      const occupied = occupiedMinutesOn(date, excludeId);
      const taken: number[] = [];
      for (const part of DAY_PARTS) {
        for (let m = part.from * 60; m < part.to * 60; m += interval) {
          // A slot is taken only when the courts already in use plus the
          // courts this booking wants exceed the venue's court count — so a
          // 2-court turf can hold two 1-court bookings at the same time.
          let overlaps = false;
          for (let k = 0; k < interval; k++) {
            if ((occupied.get(m + k) ?? 0) + courts > totalCourts) {
              overlaps = true;
              break;
            }
          }
          if (overlaps) taken.push(m);
        }
      }
      return taken;
    };
  }, [occupiedMinutesOn, interval, courts, totalCourts]);

  const bookedSlots = useMemo(
    () => takenOn(form.booking_date, editingId),
    [takenOn, form.booking_date, editingId],
  );

  /**
   * Per-slot "courts still free" count, independent of how many courts the
   * wizard's current selection wants — `takenOn` above only tells you
   * whether *this* selection fits, not how much headroom a multi-court venue
   * has at a glance. A slot's free count is the minimum across its minutes
   * (the binding constraint for booking the full slot), so a slot that's
   * fully free for 50 of its 60 minutes but loses a court for the last 10
   * still reports the lower number rather than overstating availability.
   */
  const freeCourtsOn = useMemo(() => {
    return (date: string, excludeId?: string | null) => {
      const occupied = occupiedMinutesOn(date, excludeId);
      const free = new Map<number, number>();
      for (const part of DAY_PARTS) {
        for (let m = part.from * 60; m < part.to * 60; m += interval) {
          let minFree = totalCourts;
          for (let k = 0; k < interval; k++) {
            const occ = occupied.get(m + k) ?? 0;
            minFree = Math.min(minFree, totalCourts - occ);
          }
          free.set(m, Math.max(0, minFree));
        }
      }
      return free;
    };
  }, [occupiedMinutesOn, interval, totalCourts]);

  const freeCourtsBySlot = useMemo(
    () => freeCourtsOn(form.booking_date, editingId),
    [freeCourtsOn, form.booking_date, editingId],
  );

  // Peak-hour pricing: when the day part (or date) changes, auto-pick the slot
  // rate that matches it — evening/night = peak, morning/afternoon = off-peak,
  // plus weekday/weekend names.
  const rateKey = `${dayPart}|${form.booking_date}`;
  const lastRateKey = useRef("");
  // Scrolled into view when startEdit() opens an existing booking, so the
  // wizard (which sits above the bookings list) is visibly where the edit
  // landed rather than silently changing off-screen.
  const editCardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeRates.length === 0) return;
    if (lastRateKey.current === rateKey) return;
    lastRateKey.current = rateKey;
    const match = pickRateForContext(
      activeRates.map((r) => r.slot_name),
      dayPart,
      form.booking_date,
    );
    if (match)
      setForm((f) => (f.slot_name === match ? f : { ...f, slot_name: match }));
    else if (!form.slot_name)
      setForm((f) => ({ ...f, slot_name: activeRates[0]!.slot_name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateKey, activeRates.length]);

  const rateRow = activeRates.find((r) => r.slot_name === form.slot_name);
  const rate = rateRow?.rate_per_hour ?? 0;

  const allowedIntervals = useMemo(
    () => allowedIntervalsFor(slotDurations),
    [slotDurations],
  );
  useEffect(() => {
    if (allowedIntervals.includes(interval)) return;
    // Snap to the closest available duration and clear the picked time.
    const next = allowedIntervals.reduce((best, m) =>
      Math.abs(m - interval) < Math.abs(best - interval) ? m : best,
    );
    setInterval(next);
    setSelectedSlots([]);
  }, [allowedIntervals, interval]);

  // Price for ONE slot at the chosen duration (uses the slot's own per-duration
  // price when set in Settings, otherwise the prorated hourly rate).
  const bookedMinutes = selectedSlots.length * interval;
  const hours = bookedMinutes / 60;
  // Full hours at the hourly rate + the leftover 15/30/45 min at its own rate.
  const turfAmount = rateRow
    ? priceForDuration(rateRow, bookedMinutes) * courts
    : 0;
  const gross = turfAmount;
  // Whole rupee, same as turfAmount — the discount field is free-text, so a
  // typed "50.5" would otherwise carry paise into a saved booking.
  const discountValue = Math.min(
    Math.max(rupees(Number(discount) || 0), 0),
    gross,
  );
  const total = Math.max(0, gross - discountValue);
  const balance = Math.max(0, total - rupees(form.advance_paid));

  const { data: tabEntries = [] } = useTabEntries();
  const { data: allBills = [] } = useBills();
  /** invoice_no by bill id, so a merged booking can name its bill. */
  const invoiceNoById = useMemo(
    () => new Map(allBills.map((b) => [b.id, b.invoice_no])),
    [allBills],
  );

  const duesSort = useSortState<DuesSortField>("turf-dues", DUES_SORT_OPTIONS, {
    field: "date",
    dir: "asc",
  });
  const dues = useMemo(
    () =>
      bookings
        // bookingDue() (lib/dues.ts) drops anything merged into a bill or
        // already moved onto the customer's tab, so the same rupee is never
        // shown as owed in two places.
        .filter((b) => bookingDue(b, tabEntries) > 0)
        .sort((a, b) =>
          duesSort.field === "amount"
            ? compareBy(
                bookingDue(a, tabEntries),
                bookingDue(b, tabEntries),
                duesSort.dir,
              )
            : compareBy(
                new Date(a.booking_date).getTime(),
                new Date(b.booking_date).getTime(),
                duesSort.dir,
              ),
        ),
    [bookings, tabEntries, duesSort.field, duesSort.dir],
  );
  const [duesVisible, setDuesVisible] = useState(25);
  const visibleDues = useMemo(
    () => dues.slice(0, duesVisible),
    [dues, duesVisible],
  );

  const bookingSort = useSortState<BookingSortField>(
    "turf-bookings",
    BOOKING_SORT_OPTIONS,
    {
      field: "date",
      dir: "desc",
    },
  );
  /** Set by the calendar-popup on the "Date" sort control — narrows the
   * bookings list to exactly one day. */
  const [bookingDate, setBookingDate] = useState<string | undefined>(undefined);
  const sortedBookings = useMemo(
    () =>
      [...bookings].sort((a, b) => {
        switch (bookingSort.field) {
          case "customer":
            return compareBy(
              a.customer_name.toLowerCase(),
              b.customer_name.toLowerCase(),
              bookingSort.dir,
            );
          case "slot":
            return compareBy(
              a.slot_name.toLowerCase(),
              b.slot_name.toLowerCase(),
              bookingSort.dir,
            );
          case "amount":
            return compareBy(
              bookingGrossTotal(a),
              bookingGrossTotal(b),
              bookingSort.dir,
            );
          case "date":
          default:
            return compareBy(
              new Date(a.booking_date).getTime(),
              new Date(b.booking_date).getTime(),
              bookingSort.dir,
            );
        }
      }),
    [bookings, bookingSort.field, bookingSort.dir],
  );

  /** sortedBookings narrowed to bookingDate when the calendar popup picked
   * one — used everywhere sortedBookings previously fed pagination/export,
   * so "one specific day" applies consistently across the tab. */
  const dateFilteredBookings = useMemo(
    () =>
      bookingDate
        ? sortedBookings.filter((b) => b.booking_date === bookingDate)
        : sortedBookings,
    [sortedBookings, bookingDate],
  );

  const PAGE_SIZE = 25;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(
    1,
    Math.ceil(dateFilteredBookings.length / PAGE_SIZE),
  );
  useEffect(() => {
    setPage(1);
  }, [bookings.length, bookingSort.field, bookingSort.dir, bookingDate]);
  const pageBookings = useMemo(
    () => dateFilteredBookings.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [dateFilteredBookings, page],
  );
  const activeBooking =
    pageBookings.find((b) => b.id === activeBookingId) ?? null;

  const renderBookingCard = (b: (typeof pageBookings)[number]) => {
    // Cash really collected — advance_paid is inflated to the full
    // gross when a balance is moved to dues (lib/dues.ts).
    const paid = bookingCashCollected(b, tabEntries);
    const due = bookingDue(b, tabEntries);
    const moved = bookingMovedToDues(b, tabEntries);
    const paymentState = derivePaymentState({
      paid,
      due,
      moved,
    });
    const onDues = netTabAmountFor(tabEntries, TAB_REF_TURF_BOOKING, b.id);
    const dueNo = moved
      ? dueNoForRef(
          tabEntries,
          TAB_REF_TURF_BOOKING,
          b.id,
          b.booking_no,
          b.booking_date,
        )
      : null;
    const card = (
      <div
        className={cn(
          "frost-soft lift rounded-xl border p-3 text-sm",
          moved && "opacity-60 saturate-50",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex flex-wrap items-center gap-2 font-semibold">
              <span>
                {b.booking_no} · {b.customer_name}
              </span>
              {moved ? (
                <Badge variant="secondary">Moved to dues · {dueNo}</Badge>
              ) : (
                (() => {
                  const state = bookingStateLabel(
                    b,
                    tabEntries,
                    b.merged_into_bill_id
                      ? invoiceNoById.get(b.merged_into_bill_id)
                      : null,
                  );
                  return state ? (
                    <Badge variant="outline">{state}</Badge>
                  ) : null;
                })()
              )}
            </p>

            <p className="text-muted-foreground">
              {formatDMY(b.booking_date)}
              {b.start_time && b.end_time
                ? ` · ${b.start_time}–${b.end_time}`
                : ""}{" "}
              · {b.slot_name} · {hoursLabel(b.hours)} × {b.courts ?? 1} court ×{" "}
              {money(b.rate_per_hour)}
            </p>
            {(b.snacks ?? []).length > 0 && (
              <ul className="mt-1 text-muted-foreground">
                {b.snacks.map((it, i) => (
                  <li key={i}>
                    🍿 {it.item_name} · {it.qty} × {money(it.unit_price)} ={" "}
                    {money(it.amount)}
                  </li>
                ))}
              </ul>
            )}
            <p>
              Total {money(bookingGrossTotal(b))}
              {b.snacks_total > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  · snacks {money(b.snacks_total)}
                </span>
              )}
              {b.discount > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  · discount {money(b.discount)}
                </span>
              )}{" "}
              · Paid {money(paid)}
              {due > 0 && (
                <span className="text-destructive"> · Due {money(due)}</span>
              )}
              {moved && (
                <span className="text-muted-foreground">
                  {" "}
                  · {money(onDues)} on dues
                </span>
              )}
            </p>
            {moved && (
              <p className="text-xs text-muted-foreground">
                This balance now sits on {b.customer_name}'s tab — collect it
                from Outstanding so the same money isn't counted twice.
              </p>
            )}
            {b.merged_into_bill_id && (
              <p className="text-xs text-muted-foreground">
                Now billed via the Bills tab — the total above is history only;
                don't count it again when adding up revenue here.
              </p>
            )}

            {b.notes && (
              <p className="mt-1 text-muted-foreground italic">{b.notes}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                b.status === "Confirmed" && "bg-primary/15 text-primary",
                b.status === "Arrived" && "bg-warning/15 text-warning",
                b.status === "Completed" && "bg-success/15 text-success",
                b.status === "Cancelled" &&
                  "bg-destructive/15 text-destructive",
                b.status === "No-show" && "bg-muted text-muted-foreground",
              )}
            >
              {b.status}
            </span>
            <Badge className={paymentStateBadgeClass(paymentState)}>
              {paymentStateLabel(paymentState)}
            </Badge>
            {b.merged_into_bill_id && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Merged into bill
              </span>
            )}
            <div className="flex gap-1">
              <RecordActionRow
                doc={bookingReceipt(b)}
                phone={b.phone}
                section={INVOICE_SECTIONS.turf}
                noun="booking receipt"
                size="sm"
              />
              <Button
                size="sm"
                variant="outline"
                aria-label="Reschedule booking"
                title="Reschedule"
                // Same guard as delete: a merged booking's
                // money now lives on its bill, and a moved
                // one has a live tab charge — rescheduling
                // either from here would desync data that's
                // now owned elsewhere.
                disabled={!!b.merged_into_bill_id || moved}
                onClick={() => startEdit(b)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-label="Preview booking receipt before printing"
                title="Preview"
                onClick={() =>
                  openPreview(bookingReceipt(b), INVOICE_SECTIONS.turf)
                }
              >
                <Eye className="h-4 w-4" />
              </Button>
              <ConfirmDeleteButton
                size="sm"
                disabled={!!b.merged_into_bill_id || moved}
                ariaLabel="Delete booking"
                title={`Delete booking ${b.booking_no}?`}
                description={`This permanently removes ${b.booking_no} for ${b.customer_name} and can't be undone.`}
                onConfirm={() =>
                  del.mutate(b.id, {
                    onSuccess: () => toast.success("Deleted"),
                  })
                }
              />
            </div>
          </div>
        </div>
      </div>
    );

    // Right-click menu is desktop-only — touch users have
    // no equivalent gesture here, so mobile keeps exactly
    // the plain card it already had.
    if (isMobile) {
      return <div key={b.id}>{card}</div>;
    }
    return (
      <ContextMenu key={b.id}>
        <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() =>
              printReceipt(bookingReceipt(b), undefined, INVOICE_SECTIONS.turf)
            }
          >
            <Printer className="size-4" /> Print receipt
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              downloadReceipt(
                bookingReceipt(b),
                undefined,
                INVOICE_SECTIONS.turf,
              )
            }
          >
            <Download className="size-4" /> Download PDF
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              openPreview(bookingReceipt(b), INVOICE_SECTIONS.turf)
            }
          >
            <Eye className="size-4" /> Preview
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!!b.merged_into_bill_id || moved}
            onSelect={() => startEdit(b)}
          >
            <Pencil className="size-4" /> Reschedule
          </ContextMenuItem>
          <ContextMenuSeparator />
          {b.merged_into_bill_id || moved ? (
            <ContextMenuItem disabled>
              Status locked —{" "}
              {b.merged_into_bill_id
                ? "billed via Bills tab"
                : "balance moved to Outstanding"}
            </ContextMenuItem>
          ) : (
            BOOKING_STATUSES.filter((s) => s !== b.status).map((s) => (
              <ContextMenuItem
                key={s}
                onSelect={() =>
                  update.mutate(
                    { id: b.id, status: s },
                    {
                      onSuccess: () => toast.success(`Marked ${s}`),
                    },
                  )
                }
              >
                Mark {s}
              </ContextMenuItem>
            ))
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!!b.merged_into_bill_id || moved}
            className="text-destructive focus:text-destructive"
            onSelect={() => setDeleteTarget(b)}
          >
            <Trash2 className="size-4" /> Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const toggleSlot = (m: number) =>
    setSelectedSlots((prev) => {
      // Deselect
      if (prev.includes(m)) return prev.filter((x) => x !== m);
      if (prev.length === 0) return [m];
      // Treat the second tap as the booking's end time. Fill only the slots
      // before that endpoint so 6:30 → 7:30 remains one hour, not 90 minutes.
      const min = Math.min(...prev, m);
      const max = Math.max(...prev, m);
      const next: number[] = [];
      for (let x = min; x < max; x += interval) next.push(x);
      // Don't allow the span to swallow an already-booked slot
      if (next.some((x) => bookedSlots.includes(x))) return [m];
      return next;
    });

  /**
   * Opens an existing booking in the wizard for rescheduling instead of the
   * usual delete-and-recreate. Reconstructs `selectedSlots` from the
   * booking's stored start/end time by picking the finest allowed interval
   * that evenly divides its span AND keeps the start aligned to a grid
   * line — the same alignment the slot grid itself relies on. A legacy
   * booking whose times don't land on any current grid can't be safely
   * guessed, so that case clears the selection and asks the operator to
   * re-pick the time instead of risking a silently wrong reconstruction.
   */
  const startEdit = (b: (typeof bookings)[number]) => {
    const startM = parseMinutes(b.start_time);
    const endM = parseMinutes(b.end_time);
    const span =
      startM !== null && endM !== null
        ? endM > startM
          ? endM - startM
          : endM + 1440 - startM
        : Math.max(1, Math.round((b.hours || 1) * 60));

    const sortedAllowed = [...allowedIntervals].sort((x, y) => x - y);
    const fitInterval =
      startM !== null
        ? sortedAllowed.find((iv) => span % iv === 0 && startM % iv === 0)
        : undefined;
    const nextDayPart = startM !== null ? dayPartForMinute(startM) : dayPart;

    // Pre-empt the peak-pricing auto-pick effect (rateKey above) from
    // overwriting the booking's own slot_name right after we set it below —
    // same key shape that effect computes from dayPart|booking_date.
    lastRateKey.current = `${nextDayPart}|${b.booking_date}`;

    setEditingId(b.id);
    setForm({
      booking_date: b.booking_date,
      customer_name: b.customer_name,
      phone: b.phone ?? "",
      slot_name: b.slot_name,
      advance_paid: b.advance_paid ? String(b.advance_paid) : "",
      payment_mode: b.payment_mode,
      status: b.status,
    });
    setCourts(Math.max(1, Number(b.courts ?? 1)));
    setDiscount(b.discount ? String(b.discount) : "");
    setNotes(b.notes ?? "");
    setRepeatWeeks(1);
    setDayPart(nextDayPart);

    if (fitInterval !== undefined && startM !== null) {
      setInterval(fitInterval);
      const slots: number[] = [];
      for (let m = startM; m < startM + span; m += fitInterval)
        slots.push(m % 1440);
      setSelectedSlots(slots);
    } else {
      setInterval(sortedAllowed[0] ?? 60);
      setSelectedSlots([]);
      toast.info(
        `${b.booking_no}'s time doesn't line up with the current slot grid — pick the time again.`,
      );
    }

    setBookingStep(2);
    editCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({
      booking_date: today(),
      customer_name: "",
      phone: "",
      slot_name: "",
      advance_paid: "",
      payment_mode: "Cash",
      status: "Confirmed",
    });
    setCourts(1);
    setSelectedSlots([]);
    setDiscount("");
    setNotes("");
    setRepeatWeeks(1);
    setBookingStep(1);
  };

  /**
   * Applies a pending Customers-tab hand-off: fills the new-booking form's
   * customer_name/phone and jumps straight to Step 2 (Time & court), same
   * as `startEdit` does for a known customer — there's nothing left to ask
   * on Step 1. Deliberately does NOT set `editingId`: this is still a new
   * booking, not an edit of an existing one. Runs once per hand-off (guarded
   * by the `prefillCustomer` dependency going back to null after
   * `onConsumePrefillCustomer` fires), so it won't refire on unrelated
   * re-renders or clobber the form if the owner is already mid-entry.
   */
  useEffect(() => {
    if (!prefillCustomer) return;
    setForm((f) => ({
      ...f,
      customer_name: prefillCustomer.name,
      phone: prefillCustomer.phone ?? "",
    }));
    setBookingStep(2);
    editCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    onConsumePrefillCustomer?.();
  }, [prefillCustomer, onConsumePrefillCustomer]);

  const submit = async () => {
    if (!form.customer_name.trim()) {
      toast.error("Customer name required");
      return;
    }
    if (form.phone && !/^\d{10}$/.test(form.phone)) {
      toast.error("Phone must be 10 digits");
      return;
    }
    if (!form.slot_name) {
      toast.error("Pick a slot");
      return;
    }
    if (hours === 0) {
      toast.error("Pick at least one time slot");
      return;
    }
    const sorted = [...selectedSlots].sort((a, b) => a - b);
    const weeks = Math.max(1, Math.min(52, Math.round(repeatWeeks) || 1));
    // Whole rupee — same free-text-input concern as discountValue above.
    const advance = rupees(Number(form.advance_paid) || 0);

    const basePayload = {
      customer_name: form.customer_name.trim(),
      phone: form.phone || null,
      slot_name: form.slot_name,
      hours,
      // effective hourly rate so receipts/exports stay consistent
      rate_per_hour: hours > 0 ? turfAmount / hours / courts : rate,
      discount: discountValue,
      notes: notes.trim() || null,
      total_amount: total,
      payment_mode: form.payment_mode,
      status: form.status,
      start_time: minuteLabel(sorted[0]!),
      end_time: minuteLabel(sorted[sorted.length - 1]! + interval),
      courts,
      snacks: [],
      snacks_total: 0,
      turf_amount: turfAmount,
    };

    if (editingId) {
      // Rescheduling an existing booking: single record, no weekly repeat
      // (repeatWeeks is forced back to 1 by cancelEdit/startEdit, and the
      // Extras step hides the control while editing — see BookingWizard).
      try {
        await update.mutateAsync({
          id: editingId,
          ...basePayload,
          booking_date: form.booking_date,
          advance_paid: advance,
        });
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Could not update booking",
        );
        return;
      }
      toast.success("Booking updated");
      saveCustomer.mutate({
        name: form.customer_name.trim(),
        phone: form.phone || null,
      });
      cancelEdit();
      return;
    }

    let savedCount = 0;
    let skipped = 0;
    let firstSaved: Awaited<ReturnType<typeof create.mutateAsync>> | null =
      null;

    try {
      for (let week = 0; week < weeks; week++) {
        const date = addDays(form.booking_date, week * 7);
        if (week > 0 && sorted.some((m) => takenOn(date).includes(m))) {
          skipped++;
          continue;
        }
        const saved = await create.mutateAsync({
          ...basePayload,
          booking_date: date,
          // Only the first date collects the advance; later weeks start unpaid.
          advance_paid: week === 0 ? advance : 0,
        });
        if (week === 0) firstSaved = saved;
        savedCount++;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save booking");
      return;
    }

    toast.success(
      weeks > 1
        ? `${savedCount} weekly booking${savedCount > 1 ? "s" : ""} saved${skipped ? ` · ${skipped} skipped (slot taken)` : ""}`
        : "Booking saved",
    );
    if (firstSaved && printSettings.autoPrint)
      printReceipt(
        bookingReceipt(firstSaved),
        printSettings,
        INVOICE_SECTIONS.turf,
      );
    saveCustomer.mutate({
      name: form.customer_name.trim(),
      phone: form.phone || null,
    });
    setForm({ ...form, customer_name: "", phone: "", advance_paid: "" });
    setSelectedSlots([]);
    setDiscount("");
    setNotes("");
    setRepeatWeeks(1);
    setBookingStep(1);
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="TURF"
        title="Turf bookings"
        hint="Book slots, track dues and history"
        icon={Trophy}
      />

      <LayoutSections tabId="turf" className="space-y-6">
        <LayoutSection id="turf.new-booking">
          <Card ref={editCardRef} className="frost lift border-primary/30">
            <CardContent className="space-y-4">
              <SectionHeading
                icon={Plus}
                eyebrow={editingId ? "Editing" : "New"}
                title={
                  editingId
                    ? `Reschedule ${bookings.find((b) => b.id === editingId)?.booking_no ?? "booking"}`
                    : "New turf booking"
                }
              />
              <BookingWizard
                editing={!!editingId}
                onCancelEdit={cancelEdit}
                step={bookingStep}
                setStep={setBookingStep}
                form={form}
                setForm={setForm}
                onDateChange={(d) => {
                  setForm((f) => ({ ...f, booking_date: d }));
                  setSelectedSlots([]);
                }}
                courts={courts}
                onCourtsChange={setCourts}
                dayPart={dayPart}
                onDayPartChange={setDayPart}
                interval={interval}
                onIntervalChange={(m) => {
                  setInterval(m);
                  setSelectedSlots([]);
                }}
                allowedIntervals={allowedIntervals}
                selectedSlots={selectedSlots}
                onToggleSlot={toggleSlot}
                bookedSlots={bookedSlots}
                totalCourts={totalCourts}
                freeCourtsBySlot={freeCourtsBySlot}
                activeRates={activeRates}
                turfAmount={turfAmount}
                gross={gross}
                bookedMinutes={bookedMinutes}
                hours={hours}
                discount={discount}
                onDiscountChange={setDiscount}
                discountValue={discountValue}
                notes={notes}
                onNotesChange={setNotes}
                repeatWeeks={repeatWeeks}
                onRepeatWeeksChange={setRepeatWeeks}
                total={total}
                balance={balance}
                onSubmit={submit}
                submitting={create.isPending || update.isPending}
              />
              {repeatWeeks > 1 && (
                <p className="text-[11px] text-muted-foreground">
                  {formatDMY(form.booking_date)} →{" "}
                  {formatDMY(addDays(form.booking_date, (repeatWeeks - 1) * 7))}{" "}
                  · advance applies to the first date only
                </p>
              )}
            </CardContent>
          </Card>
        </LayoutSection>

        <LayoutSection id="turf.calendar">
          <TurfCalendarCard />
        </LayoutSection>

        {dues.length > 0 && (
          <LayoutSection id="turf.pending-dues">
            <Card>
              <CardContent className="space-y-3">
                <LayoutParts
                  sectionId="turf.pending-dues"
                  className="space-y-3"
                >
                  <LayoutPart id="turf.pending-dues.heading">
                    <SectionHeading
                      icon={AlertCircle}
                      eyebrow="Collections"
                      title="Pending dues"
                      action={
                        <SortMenu
                          options={DUES_SORT_OPTIONS}
                          field={duesSort.field}
                          dir={duesSort.dir}
                          onFieldChange={duesSort.setField}
                          onToggleDir={duesSort.toggleDir}
                        />
                      }
                    />
                  </LayoutPart>
                  <LayoutPart id="turf.pending-dues.list" className="space-y-3">
                    <ListDisclosure
                      storageKey="turf.pending-dues"
                      label="Pending dues"
                      count={dues.length}
                    >
                      {visibleDues.map((b) => {
                        const due = bookingDue(b, tabEntries);
                        // Whole rupee — same free-text-input concern as discountValue/advance above.
                        const entered = rupees(
                          Number(collect[b.id] ?? "") || 0,
                        );
                        const pay = Math.min(Math.max(entered, 0), due);
                        return (
                          <div
                            key={b.id}
                            className="frost-soft lift space-y-2 rounded-xl border p-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm">
                                <p className="font-medium">
                                  {b.customer_name} · {b.booking_no}
                                </p>
                                <p className="stat-value text-destructive">
                                  Due {money(due)}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={update.isPending}
                                onClick={() =>
                                  update.mutate(
                                    {
                                      id: b.id,
                                      // Tax-inclusive: clearing the due means collecting
                                      // the receipt's grand total, not the pre-tax figure.
                                      advance_paid: bookingGrossTotal(b),
                                      status: "Completed",
                                    },
                                    {
                                      onSuccess: () => {
                                        setCollect((c) => ({
                                          ...c,
                                          [b.id]: "",
                                        }));
                                        toast.success("Marked as paid");
                                      },
                                    },
                                  )
                                }
                              >
                                <CheckCircle2 className="mr-1 h-4 w-4" /> Mark
                                paid
                              </Button>
                            </div>
                            <div className="flex items-center gap-2">
                              <Input
                                inputMode="decimal"
                                className="h-9"
                                placeholder={`Part payment (max ${money(due)})`}
                                value={collect[b.id] ?? ""}
                                onChange={(e) =>
                                  setCollect((c) => ({
                                    ...c,
                                    [b.id]: e.target.value,
                                  }))
                                }
                              />
                              <Button
                                size="sm"
                                disabled={pay <= 0 || update.isPending}
                                onClick={() => {
                                  const paid = b.advance_paid + pay;
                                  update.mutate(
                                    {
                                      id: b.id,
                                      advance_paid: paid,
                                      ...(paid >= bookingGrossTotal(b)
                                        ? { status: "Completed" }
                                        : {}),
                                    },
                                    {
                                      onSuccess: () => {
                                        setCollect((c) => ({
                                          ...c,
                                          [b.id]: "",
                                        }));
                                        toast.success(
                                          `Collected ${money(pay)} · balance ${money(Math.max(0, due - pay))}`,
                                        );
                                      },
                                      onError: (e) => toast.error(e.message),
                                    },
                                  );
                                }}
                              >
                                Collect
                              </Button>
                            </div>
                            {/* Moves the outstanding balance onto the customer's running tab as a
                      Turf charge and clears it off the booking, so the same rupee is
                      never owed in both places. */}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="w-full justify-center text-primary"
                              disabled={
                                addTabEntry.isPending || update.isPending
                              }
                              onClick={() => {
                                if (!b.customer_name?.trim()) {
                                  toast.error(
                                    "This booking has no customer name to open a tab for",
                                  );
                                  return;
                                }
                                addTabEntry.mutate(
                                  {
                                    name: b.customer_name,
                                    phone: b.phone,
                                    kind: "charge",
                                    business: "Turf",
                                    amount: due,
                                    note: `Turf booking ${b.booking_no}`,
                                    ref_type: "turf_booking",
                                    ref_id: b.id,
                                    entry_date: b.booking_date,
                                  },
                                  {
                                    onSuccess: () =>
                                      update.mutate(
                                        {
                                          id: b.id,
                                          // The tab charge above is the tax-inclusive
                                          // balance, so the booking is settled at gross.
                                          advance_paid: bookingGrossTotal(b),
                                          status: "Completed",
                                          notes: [
                                            b.notes,
                                            `${money(due)} moved to tab`,
                                          ]
                                            .filter(Boolean)
                                            .join(" · "),
                                        },
                                        {
                                          onSuccess: () =>
                                            toast.success(
                                              `${money(due)} put on ${b.customer_name}'s tab`,
                                            ),
                                          onError: (e) =>
                                            toast.error(e.message),
                                        },
                                      ),
                                    onError: (e) => toast.error(e.message),
                                  },
                                );
                              }}
                            >
                              <NotebookPen className="mr-1 h-4 w-4" /> Put
                              balance on tab
                            </Button>
                          </div>
                        );
                      })}

                      {dues.length > duesVisible && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => setDuesVisible((v) => v + PAGE_SIZE)}
                        >
                          Show more ({dues.length - duesVisible} remaining)
                        </Button>
                      )}
                    </ListDisclosure>
                  </LayoutPart>
                </LayoutParts>
              </CardContent>
            </Card>
          </LayoutSection>
        )}

        <LayoutSection id="turf.bookings">
          <Card>
            <CardContent className="space-y-3">
              <LayoutParts sectionId="turf.bookings" className="space-y-3">
                <LayoutPart id="turf.bookings.heading">
                  <SectionHeading
                    icon={ListChecks}
                    eyebrow="History"
                    title="Bookings"
                  />
                </LayoutPart>
                <LayoutPart id="turf.bookings.toolbar">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <SortMenu
                      options={BOOKING_SORT_OPTIONS}
                      field={bookingSort.field}
                      dir={bookingSort.dir}
                      onFieldChange={bookingSort.setField}
                      onToggleDir={bookingSort.toggleDir}
                      dateField="date"
                      selectedDate={bookingDate}
                      onSelectDate={setBookingDate}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        exportToExcel(
                          dateFilteredBookings.flatMap((b) => {
                            const merged = !!b.merged_into_bill_id;
                            const base = {
                              "Booking ID": b.booking_no,
                              Date: formatDMY(b.booking_date),
                              Customer: b.customer_name,
                              Phone: b.phone ?? "",
                              Slot: b.slot_name,
                              Time:
                                b.start_time && b.end_time
                                  ? `${b.start_time} - ${b.end_time}`
                                  : "",
                              Courts: b.courts,
                              Hours: b.hours,
                              "Rate/hr": b.rate_per_hour,
                              "Payment mode": b.payment_mode,
                              Status: b.status,
                              // Once merged, this booking's revenue lives on the Bill
                              // instead (see Bills sheet) — money columns below are
                              // zeroed so summing this sheet + the Bills sheet doesn't
                              // count the same rupees twice. The row itself is kept so
                              // the booking's history/occupancy record isn't lost.
                              Merged: merged
                                ? "Yes \u2014 see Bills sheet"
                                : "No",
                            };
                            const rows: Record<string, string | number>[] = [
                              {
                                ...base,
                                Type: "Turf",
                                Item: `${b.slot_name} slot`,
                                Qty: b.hours,
                                // `??`, not `||` — see Finding #3: a genuinely
                                // comped turf_amount of 0 must export as 0.
                                Amount: merged
                                  ? 0
                                  : (b.turf_amount ??
                                    b.hours *
                                      b.rate_per_hour *
                                      (b.courts ?? 1)),
                                Discount: merged ? 0 : b.discount,
                                "Grand total": merged
                                  ? 0
                                  : bookingGrossTotal(b),
                                Advance: merged ? 0 : b.advance_paid,
                                Balance: merged
                                  ? 0
                                  : Math.max(
                                      0,
                                      bookingGrossTotal(b) - b.advance_paid,
                                    ),
                                Notes: b.notes ?? "",
                              },
                            ];
                            for (const it of b.snacks ?? []) {
                              rows.push({
                                ...base,
                                Type: "Snack",
                                Item: it.item_name,
                                Qty: it.qty,
                                Amount: merged ? 0 : it.amount,
                                Discount: 0,
                                "Grand total": merged
                                  ? 0
                                  : bookingGrossTotal(b),
                                Advance: merged ? 0 : b.advance_paid,
                                Balance: merged
                                  ? 0
                                  : Math.max(
                                      0,
                                      bookingGrossTotal(b) - b.advance_paid,
                                    ),
                                Notes: "",
                              });
                            }
                            return rows;
                          }),
                          `turf-bookings-${sortSuffix(bookingSort.field, bookingSort.dir)}`,
                          "Bookings",
                          INVOICE_SECTIONS.turf,
                        )
                      }
                    >
                      <FileDown className="h-4 w-4" /> Excel
                    </Button>
                  </div>
                </LayoutPart>
                <LayoutPart id="turf.bookings.list" className="space-y-3">
                  {isMobile ? (
                    <ListDisclosure
                      storageKey="turf.bookings"
                      label="Bookings"
                      count={dateFilteredBookings.length}
                    >
                      {bookingDate && (
                        <div className="frost-soft flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm">
                          <span>
                            Showing{" "}
                            <span className="font-medium">
                              {dateFilteredBookings.length}
                            </span>{" "}
                            booking
                            {dateFilteredBookings.length === 1
                              ? ""
                              : "s"} for{" "}
                            <span className="font-medium">
                              {formatDMY(bookingDate)}
                            </span>
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setBookingDate(undefined)}
                          >
                            Clear
                          </Button>
                        </div>
                      )}
                      {bookings.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No bookings yet.
                        </p>
                      )}
                      {pageBookings.map(renderBookingCard)}
                      {dateFilteredBookings.length > PAGE_SIZE && (
                        <div className="flex items-center justify-between pt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={page <= 1}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                          >
                            <ChevronLeft className="mr-1 h-4 w-4" /> Prev
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            Page {page} of {pageCount} ·{" "}
                            {dateFilteredBookings.length} bookings
                            {bookingDate
                              ? ` (of ${bookings.length} total)`
                              : ""}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={page >= pageCount}
                            onClick={() =>
                              setPage((p) => Math.min(pageCount, p + 1))
                            }
                          >
                            Next <ChevronRight className="ml-1 h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </ListDisclosure>
                  ) : (
                    // Desktop list/detail split, same pattern as Bills/
                    // Outstanding/Customers: compact rows on the left pick
                    // which booking's full existing card (unchanged —
                    // receipt actions, reschedule, delete, status context
                    // menu, all of it) renders in the sticky right pane.
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-start gap-4">
                      <div className="min-w-0 space-y-3">
                        <p className="micro-label px-1">
                          Bookings{" "}
                          <span className="text-muted-foreground">
                            ({dateFilteredBookings.length})
                          </span>
                        </p>
                        {bookingDate && (
                          <div className="frost-soft flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm">
                            <span>
                              Showing{" "}
                              <span className="font-medium">
                                {dateFilteredBookings.length}
                              </span>{" "}
                              booking
                              {dateFilteredBookings.length === 1
                                ? ""
                                : "s"} for{" "}
                              <span className="font-medium">
                                {formatDMY(bookingDate)}
                              </span>
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setBookingDate(undefined)}
                            >
                              Clear
                            </Button>
                          </div>
                        )}
                        {bookings.length === 0 && (
                          <p className="text-sm text-muted-foreground">
                            No bookings yet.
                          </p>
                        )}
                        {pageBookings.map((b) => {
                          const due = bookingDue(b, tabEntries);
                          const moved = bookingMovedToDues(b, tabEntries);
                          return (
                            <button
                              key={b.id}
                              type="button"
                              className={cn(
                                "frost-soft lift flex w-full items-center justify-between gap-2 rounded-xl border p-2.5 text-left",
                                activeBookingId === b.id
                                  ? "border-primary/50 ring-1 ring-primary/30"
                                  : undefined,
                                moved ? "opacity-60 saturate-50" : undefined,
                              )}
                              onClick={() => setActiveBookingId(b.id)}
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {b.booking_no} · {b.customer_name}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {formatDMY(b.booking_date)}
                                  {b.start_time && b.end_time
                                    ? ` · ${b.start_time}–${b.end_time}`
                                    : ""}{" "}
                                  · {b.slot_name}
                                  {due > 0 && (
                                    <span className="text-destructive">
                                      {" "}
                                      · Due {money(due)}
                                    </span>
                                  )}
                                </p>
                              </div>
                              <span
                                className={cn(
                                  "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                                  b.status === "Confirmed" &&
                                    "bg-primary/15 text-primary",
                                  b.status === "Arrived" &&
                                    "bg-warning/15 text-warning",
                                  b.status === "Completed" &&
                                    "bg-success/15 text-success",
                                  b.status === "Cancelled" &&
                                    "bg-destructive/15 text-destructive",
                                  b.status === "No-show" &&
                                    "bg-muted text-muted-foreground",
                                )}
                              >
                                {b.status}
                              </span>
                            </button>
                          );
                        })}
                        {dateFilteredBookings.length > PAGE_SIZE && (
                          <div className="flex items-center justify-between pt-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={page <= 1}
                              onClick={() => setPage((p) => Math.max(1, p - 1))}
                            >
                              <ChevronLeft className="mr-1 h-4 w-4" /> Prev
                            </Button>
                            <span className="text-xs text-muted-foreground">
                              Page {page} of {pageCount} ·{" "}
                              {dateFilteredBookings.length} bookings
                              {bookingDate
                                ? ` (of ${bookings.length} total)`
                                : ""}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={page >= pageCount}
                              onClick={() =>
                                setPage((p) => Math.min(pageCount, p + 1))
                              }
                            >
                              Next <ChevronRight className="ml-1 h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="sticky top-24 min-w-0">
                        {activeBooking ? (
                          renderBookingCard(activeBooking)
                        ) : (
                          <Card className="frost-well border-dashed">
                            <CardContent className="flex min-h-[16rem] flex-col items-center justify-center gap-2 pt-5 text-center text-sm text-muted-foreground">
                              <ListChecks className="size-6 opacity-50" />
                              <p>
                                Select a booking to see its full detail, receipt
                                actions and status options.
                              </p>
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    </div>
                  )}
                </LayoutPart>
              </LayoutParts>
            </CardContent>
          </Card>
        </LayoutSection>
      </LayoutSections>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete booking {deleteTarget?.booking_no}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {deleteTarget?.booking_no} for{" "}
              {deleteTarget?.customer_name} and can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget)
                  del.mutate(deleteTarget.id, {
                    onSuccess: () => toast.success("Deleted"),
                  });
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {previewDialog}
    </div>
  );
}
