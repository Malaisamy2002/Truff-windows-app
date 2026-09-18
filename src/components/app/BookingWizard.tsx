import { type Dispatch, type SetStateAction, useState } from "react";
import {
  UserRound,
  CalendarClock,
  SlidersHorizontal,
  Wallet,
  ChevronLeft,
  ChevronRight,
  Percent,
  Check,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { money } from "@/lib/biz";
import { CustomerFields } from "./CustomerFields";
import { TimeSlotPicker } from "./TimeSlotPicker";
import { rangeLabel, hoursLabel, type DayPartId } from "@/lib/time-slot-utils";
import {
  PAYMENT_MODES,
  BOOKING_STATUSES,
  rateForInterval,
  type TurfRate,
} from "@/lib/ops";

export type BookingFormState = {
  booking_date: string;
  customer_name: string;
  phone: string;
  slot_name: string;
  advance_paid: string;
  payment_mode: string;
  status: string;
};

const STEPS = [
  { n: 1, label: "Customer", icon: UserRound },
  { n: 2, label: "Time & court", icon: CalendarClock },
  { n: 3, label: "Extras", icon: SlidersHorizontal },
  { n: 4, label: "Payment", icon: Wallet },
] as const;

type Step = (typeof STEPS)[number]["n"];

export function BookingWizard({
  step,
  setStep,
  form,
  setForm,
  onDateChange,
  courts,
  onCourtsChange,
  dayPart,
  onDayPartChange,
  interval,
  onIntervalChange,
  allowedIntervals,
  selectedSlots,
  onToggleSlot,
  bookedSlots,
  totalCourts,
  freeCourtsBySlot,
  activeRates,
  turfAmount,
  gross,
  bookedMinutes,
  hours,
  discount,
  onDiscountChange,
  discountValue,
  notes,
  onNotesChange,
  repeatWeeks,
  onRepeatWeeksChange,
  total,
  balance,
  onSubmit,
  submitting,
  editing = false,
  onCancelEdit,
}: {
  step: Step;
  setStep: (s: Step) => void;
  form: BookingFormState;
  setForm: Dispatch<SetStateAction<BookingFormState>>;
  onDateChange: (date: string) => void;
  courts: number;
  onCourtsChange: (n: number) => void;
  dayPart: DayPartId;
  onDayPartChange: (p: DayPartId) => void;
  interval: number;
  onIntervalChange: (m: number) => void;
  allowedIntervals: readonly number[];
  selectedSlots: number[];
  onToggleSlot: (m: number) => void;
  bookedSlots: number[];
  /** Venue's total court count, for the "N of M courts free" per-slot detail. */
  totalCourts?: number;
  /** minute -> courts still free at that minute, for multi-court venues. */
  freeCourtsBySlot?: Map<number, number>;
  activeRates: TurfRate[];
  turfAmount: number;
  gross: number;
  bookedMinutes: number;
  hours: number;
  discount: string;
  onDiscountChange: (v: string) => void;
  discountValue: number;
  notes: string;
  onNotesChange: (v: string) => void;
  repeatWeeks: number;
  onRepeatWeeksChange: (n: number) => void;
  total: number;
  balance: number;
  onSubmit: () => void;
  submitting: boolean;
  /** True while rescheduling an existing booking rather than creating one —
   * swaps the submit button's label, drops the weekly-repeat option (a
   * reschedule is always a single record), and shows a way back out. */
  editing?: boolean;
  onCancelEdit?: () => void;
}) {
  const [extrasExpanded, setExtrasExpanded] = useState(false);

  const canLeaveStep1 = form.customer_name.trim().length > 0;
  const canLeaveStep2 = hours > 0 && Boolean(form.slot_name);

  const goNext = () => {
    if (step === 1 && !canLeaveStep1) return;
    if (step === 2 && !canLeaveStep2) return;
    if (step < 4) setStep((step + 1) as Step);
  };
  const goBack = () => {
    if (step > 1) setStep((step - 1) as Step);
  };

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center gap-1.5">
        {STEPS.map((s, i) => {
          const active = s.n === step;
          const done = s.n < step;
          const Icon = s.icon;
          return (
            <button
              key={s.n}
              type="button"
              onClick={() => {
                // Only allow jumping back, or forward through steps already unlocked.
                if (s.n < step) setStep(s.n);
              }}
              className={cn(
                "flex flex-1 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-xs font-medium transition-colors",
                active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : done
                    ? "border-transparent text-muted-foreground hover:text-foreground"
                    : "border-transparent text-muted-foreground/50",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px]",
                  active
                    ? "bg-primary text-primary-foreground"
                    : done
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3" /> : s.n}
              </span>
              <Icon className="hidden size-3.5 sm:block" />
              <span className="hidden sm:inline">{s.label}</span>
              {i < STEPS.length - 1 && <span className="sr-only">, </span>}
            </button>
          );
        })}
      </div>

      {/* Step 1: Customer */}
      {step === 1 && (
        <div className="space-y-3">
          <CustomerFields
            name={form.customer_name}
            phone={form.phone}
            onChange={({ name, phone }) =>
              setForm((f) => ({ ...f, customer_name: name, phone }))
            }
          />
          {!form.customer_name.trim() && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setForm((f) => ({ ...f, customer_name: "Walk-in" }))
              }
            >
              Walk-in customer
            </Button>
          )}
        </div>
      )}

      {/* Step 2: Time & court */}
      {step === 2 && (
        <div className="space-y-3">
          <TimeSlotPicker
            date={form.booking_date}
            onDateChange={onDateChange}
            courts={courts}
            onCourtsChange={onCourtsChange}
            dayPart={dayPart}
            onDayPartChange={onDayPartChange}
            interval={interval}
            allowedIntervals={allowedIntervals}
            onIntervalChange={onIntervalChange}
            selected={selectedSlots}
            onToggleSlot={onToggleSlot}
            bookedSlots={bookedSlots}
            {...(totalCourts !== undefined ? { totalCourts } : {})}
            {...(freeCourtsBySlot !== undefined ? { freeCourtsBySlot } : {})}
          />
          <div className="space-y-1">
            <Label className="text-xs">Slot rate</Label>
            <Select
              value={form.slot_name}
              onValueChange={(v) => setForm((f) => ({ ...f, slot_name: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select slot rate" />
              </SelectTrigger>
              <SelectContent>
                {activeRates.map((r) => (
                  <SelectItem key={r.id} value={r.slot_name}>
                    {r.slot_name} — {money(rateForInterval(r, interval))}/
                    {interval === 60 ? "hr" : `${interval} min`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {bookedMinutes > 0 && (
            <p className="frost-soft rounded-lg border px-3 py-2 text-xs text-muted-foreground">
              {rangeLabel(selectedSlots, interval)} · {hoursLabel(hours)} ×{" "}
              {courts} court
              {courts > 1 ? "s" : ""} ·{" "}
              <span className="font-medium">{money(turfAmount)}</span>
            </p>
          )}
        </div>
      )}

      {/* Step 3: Extras (optional) */}
      {step === 3 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Optional — skip straight to Payment if none of this applies.
          </p>
          {!extrasExpanded ? (
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start font-normal"
              onClick={() => setExtrasExpanded(true)}
            >
              <Percent className="mr-2 h-4 w-4" />
              {discountValue > 0 || notes || repeatWeeks > 1
                ? "Edit discount, notes or repeat"
                : "Add discount, notes or repeat weekly"}
            </Button>
          ) : (
            <div className="frost-soft space-y-3 rounded-xl border p-3">
              <div className="space-y-1">
                <Label className="text-xs">Discount amount (₹)</Label>
                <Input
                  inputMode="decimal"
                  value={discount}
                  onChange={(e) => onDiscountChange(e.target.value)}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">
                  Combined total {money(gross)} · after discount {money(total)}
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => onNotesChange(e.target.value)}
                  placeholder="e.g. regular customer, rain reschedule"
                />
              </div>
              {!editing && (
                <div className="space-y-1">
                  <Label className="text-xs">Repeat weekly</Label>
                  <Select
                    value={String(repeatWeeks)}
                    onValueChange={(v) => onRepeatWeeksChange(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">One-time only</SelectItem>
                      {[2, 3, 4, 6, 8, 12].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          Same slot for {n} weeks
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {editing && (
                <p className="text-xs text-muted-foreground">
                  Repeat isn't available while rescheduling an existing booking.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Step 4: Payment */}
      {step === 4 && (
        <div className="space-y-3">
          <div className="frost-soft space-y-1.5 rounded-xl border p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Turf amount</span>
              <span>{money(turfAmount)}</span>
            </div>
            {discountValue > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Discount</span>
                <span>− {money(discountValue)}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-1.5 font-semibold">
              <span>Total</span>
              <span>{money(total)}</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Paid now (advance)</Label>
              <Input
                inputMode="decimal"
                value={form.advance_paid}
                onChange={(e) =>
                  setForm((f) => ({ ...f, advance_paid: e.target.value }))
                }
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Balance</Label>
              <Input
                readOnly
                disabled
                value={money(balance)}
                className={cn(balance > 0 && "!text-destructive font-semibold")}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Payment mode</Label>
              <Select
                value={form.payment_mode}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, payment_mode: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BOOKING_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center gap-2 pt-1">
        {editing && onCancelEdit && (
          <Button type="button" variant="ghost" onClick={onCancelEdit}>
            Cancel edit
          </Button>
        )}
        {step > 1 && (
          <Button type="button" variant="outline" onClick={goBack}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Back
          </Button>
        )}
        {step < 4 ? (
          <Button
            type="button"
            className="flex-1"
            onClick={goNext}
            disabled={
              (step === 1 && !canLeaveStep1) || (step === 2 && !canLeaveStep2)
            }
          >
            Next <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="button"
            className="flex-1"
            onClick={onSubmit}
            disabled={submitting}
            data-shortcut="save"
          >
            {editing ? (
              <>
                <Check className="mr-1 h-4 w-4" /> Update booking
              </>
            ) : (
              <>
                <Plus className="mr-1 h-4 w-4" /> Confirm booking
                {repeatWeeks > 1 ? ` × ${repeatWeeks} weeks` : ""}
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
