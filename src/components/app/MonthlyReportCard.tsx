import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useAppSettings } from "@/lib/settings";

export function MonthlyReportCard() {
  const { settings, save } = useAppSettings();

  return (
    <section className="space-y-3">
      <Card className="frost">
        <CardContent className="frost-soft lift rounded-xl p-4">
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">
              Remind me to share last month's statement
              <span className="micro-label mt-1 block font-normal text-muted-foreground">
                Shows a banner on the dashboard once a new month starts, with
                the previous month's branded PDF ready to share on WhatsApp —
                there's no server here to send it automatically, so this is a
                one-tap prompt instead of a silent auto-send.
              </span>
            </span>
            <Switch
              checked={settings.monthlyReportEnabled}
              onCheckedChange={(checked) =>
                save({ ...settings, monthlyReportEnabled: checked })
              }
            />
          </label>
        </CardContent>
      </Card>
    </section>
  );
}
