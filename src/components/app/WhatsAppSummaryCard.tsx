import { toast } from "sonner";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBills } from "@/lib/data";
import { useExpensesV2, useSnackSales, useTurfBookings } from "@/lib/ops";
import { dayKey, paymentSplit, statsForDay } from "@/lib/analytics";
import { BUSINESS_NAME, formatDMY, money, whatsappUrl } from "@/lib/biz";
import { openExternal } from "@/lib/desktop";
import { usePrintSettings } from "@/lib/print";
import { useAppSettings } from "@/lib/settings";
import { useTabEntries } from "@/lib/tabs";

export function WhatsAppSummaryCard() {
  const { settings, save } = useAppSettings();
  const { settings: printSettings } = usePrintSettings();
  const { data: bills = [] } = useBills();
  const { data: bookings = [] } = useTurfBookings();
  const { data: sales = [] } = useSnackSales();
  const { data: expenses = [] } = useExpensesV2();
  const { data: tabEntries = [] } = useTabEntries();

  const send = async () => {
    const today = dayKey(new Date());
    // Same source object (tab ledger included) as the Dashboard's "today".
    const src = { bills, bookings, sales, expenses, tabEntries };
    const s = statsForDay(src, today);
    const split = paymentSplit(src, (iso) => dayKey(iso) === today);
    const modeText = split
      .filter((m) => m.value > 0)
      .map((m) => `${m.name} ${money(m.value)}`)
      .join(" · ");
    const dateText = formatDMY(today);

    const text = [
      `*${printSettings.shopName || BUSINESS_NAME} — Daily summary (${dateText})*`,
      `Collected: ${money(s.collected)}${modeText ? `\n${modeText}` : ""}`,
      `Revenue (incl. tax): ${money(s.revenue)} (Tax: ${money(s.tax)}) · Expenses: ${money(s.expenses)} · Profit: ${money(s.profit)}`,
      `Turf bookings: ${bookings.filter((b) => b.booking_date === today && b.status !== "Cancelled").length} · Snack bills: ${sales.filter((x) => x.sale_date === today).length}`,
      `Pending dues: ${money(s.dues)}`,
    ].join("\n");

    // Same phone-formatting rule (10-digit numbers get "91" prepended) and
    // the same desktop-safe navigation as every other WhatsApp entry point
    // (DashboardTab.tsx, BillActions.tsx, receipt.ts) — plain `window.open`
    // is unreliable inside the Tauri webview (see desktop.ts).
    const url = whatsappUrl(text, settings.whatsappOwner);
    const opened = await openExternal(url);
    if (opened) {
      toast.success("Opening WhatsApp", {
        description: "Review and tap send.",
      });
    } else {
      toast.error("Couldn't open WhatsApp automatically", {
        description: "Your device didn't allow the app to open the link.",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="h-4 w-4" /> Daily summary on WhatsApp
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Builds today&apos;s collection, profit and dues summary and opens
          WhatsApp with the message pre-filled — one tap to send it to the
          owner.
        </p>
        <div className="space-y-1">
          <Label className="text-xs">
            Owner&apos;s WhatsApp number (with country code)
          </Label>
          <Input
            inputMode="tel"
            value={settings.whatsappOwner}
            onChange={(e) =>
              save({ ...settings, whatsappOwner: e.target.value })
            }
            placeholder="91 98765 43210"
          />
        </div>
        <Button onClick={send}>
          <MessageCircle className="mr-1 h-4 w-4" /> Send today&apos;s summary
        </Button>
      </CardContent>
    </Card>
  );
}
