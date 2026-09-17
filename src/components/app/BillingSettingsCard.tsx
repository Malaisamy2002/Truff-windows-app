import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  formatInvoiceNo,
  newCustomTaxId,
  useAppSettings,
  type CustomTax,
} from "@/lib/settings";
import { SectionHeading } from "./SectionHeading";
import { SettingsSwitchRow } from "./SettingsField";

export function BillingSettingsCard() {
  const { settings, save } = useAppSettings();
  const set = <K extends keyof typeof settings>(
    k: K,
    v: (typeof settings)[K],
  ) => save({ ...settings, [k]: v });
  const [gstRateDraft, setGstRateDraft] = useState(String(settings.gstRate));
  const [billStartDraft, setBillStartDraft] = useState(
    String(settings.billStartNo),
  );
  const [billPrefixDraft, setBillPrefixDraft] = useState(settings.billPrefix);
  const [taxRateDrafts, setTaxRateDrafts] = useState<Record<string, string>>(
    {},
  );
  useEffect(
    () => setGstRateDraft(String(settings.gstRate)),
    [settings.gstRate],
  );
  useEffect(
    () => setBillStartDraft(String(settings.billStartNo)),
    [settings.billStartNo],
  );
  useEffect(
    () => setBillPrefixDraft(settings.billPrefix),
    [settings.billPrefix],
  );
  useEffect(() => {
    setTaxRateDrafts((current) => {
      const next: Record<string, string> = {};
      for (const tax of settings.customTaxes)
        next[tax.id] = current[tax.id] ?? String(tax.rate);
      return next;
    });
  }, [settings.customTaxes]);
  const boundedNumber = (
    value: string,
    fallback: number,
    min = 0,
    max = 100,
  ) => {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? Math.max(min, Math.min(max, parsed))
      : fallback;
  };

  return (
    <section className="space-y-3">
      <SectionHeading eyebrow="BILLING" title="Billing & GST" icon={Receipt} />
      <Card className="frost">
        <CardContent className="space-y-4 p-4">
          <SettingsSwitchRow
            label="GST on bills"
            hint="Adds GST to bills, turf bookings and snacks receipts alike. Already-issued receipts keep the rate they were made with."
            checked={settings.gstEnabled}
            onCheckedChange={(v) => set("gstEnabled", v)}
          />

          {settings.gstEnabled && (
            <div className="space-y-1.5">
              <Label className="micro-label">GST rate %</Label>
              <div className="flex flex-wrap gap-2">
                {[5, 12, 18, 28].map((rate) => (
                  <Button
                    key={rate}
                    type="button"
                    size="sm"
                    variant={settings.gstRate === rate ? "default" : "outline"}
                    onClick={() => set("gstRate", rate)}
                  >
                    {rate}%
                  </Button>
                ))}
              </div>
              <Input
                inputMode="decimal"
                value={gstRateDraft}
                onChange={(e) => setGstRateDraft(e.target.value)}
                onBlur={() => set("gstRate", boundedNumber(gstRateDraft, 0))}
                placeholder="Custom rate, e.g. 1 for composition scheme"
              />
            </div>
          )}

          <div className="space-y-3 border-t pt-4">
            <p className="micro-label">Business registration</p>
            <SettingsSwitchRow
              label="Show GSTIN on bills"
              hint="Prints your GSTIN in the bill header."
              checked={settings.gstinEnabled}
              onCheckedChange={(v) => set("gstinEnabled", v)}
            />
            {settings.gstinEnabled && (
              <div className="space-y-1">
                <Label className="text-xs">GSTIN</Label>
                <Input
                  value={settings.gstin}
                  onChange={(e) =>
                    set("gstin", e.target.value.trim().toUpperCase())
                  }
                  placeholder="22AAAAA0000A1Z5"
                  maxLength={15}
                />
              </div>
            )}

            <SettingsSwitchRow
              label="Show FSSAI license on bills"
              hint="Prints your FSSAI license number in the bill header."
              checked={settings.fssaiEnabled}
              onCheckedChange={(v) => set("fssaiEnabled", v)}
            />
            {settings.fssaiEnabled && (
              <div className="space-y-1">
                <Label className="text-xs">FSSAI license number</Label>
                <Input
                  value={settings.fssaiNumber}
                  onChange={(e) =>
                    set("fssaiNumber", e.target.value.replace(/\s/g, ""))
                  }
                  placeholder="14 digit FSSAI no."
                  maxLength={14}
                  inputMode="numeric"
                />
              </div>
            )}
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="micro-label">Additional taxes / charges</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Any number of extra taxes, each with its own on/off switch and
                  rate — e.g. Service Charge, Cess. Shown as its own line
                  whenever it's on.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => {
                  const next: CustomTax = {
                    id: newCustomTaxId(),
                    label: "",
                    rate: 0,
                    enabled: true,
                  };
                  set("customTaxes", [...settings.customTaxes, next]);
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add tax
              </Button>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Quick add</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Cess", rate: 1 },
                  { label: "Service Charge", rate: 5 },
                  { label: "Service Charge", rate: 10 },
                ].map((preset) => (
                  <Button
                    key={`${preset.label}-${preset.rate}`}
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const existing = settings.customTaxes.find(
                        (t) =>
                          t.label === preset.label && t.rate === preset.rate,
                      );
                      if (existing) {
                        if (existing.enabled) {
                          toast.info(
                            `${preset.label} @${preset.rate}% is already on`,
                          );
                          return;
                        }
                        set(
                          "customTaxes",
                          settings.customTaxes.map((t) =>
                            t.id === existing.id ? { ...t, enabled: true } : t,
                          ),
                        );
                        return;
                      }
                      set("customTaxes", [
                        ...settings.customTaxes,
                        {
                          id: newCustomTaxId(),
                          label: preset.label,
                          rate: preset.rate,
                          enabled: true,
                        },
                      ]);
                    }}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {preset.label} {preset.rate}%
                  </Button>
                ))}
              </div>
            </div>

            {settings.customTaxes.length > 0 && (
              <div className="space-y-2">
                {settings.customTaxes.map((tax) => (
                  <div
                    key={tax.id}
                    className="frost-soft flex flex-wrap items-center gap-2 rounded-xl border p-2"
                  >
                    <Input
                      value={tax.label}
                      onChange={(e) =>
                        set(
                          "customTaxes",
                          settings.customTaxes.map((t) =>
                            t.id === tax.id
                              ? { ...t, label: e.target.value }
                              : t,
                          ),
                        )
                      }
                      placeholder="Tax name (e.g. Service Charge)"
                      className="w-full min-w-0 sm:w-auto sm:flex-1"
                    />
                    <Input
                      inputMode="decimal"
                      value={taxRateDrafts[tax.id] ?? String(tax.rate)}
                      onChange={(e) =>
                        setTaxRateDrafts((current) => ({
                          ...current,
                          [tax.id]: e.target.value,
                        }))
                      }
                      onBlur={() =>
                        set(
                          "customTaxes",
                          settings.customTaxes.map((t) =>
                            t.id === tax.id
                              ? {
                                  ...t,
                                  rate: boundedNumber(
                                    taxRateDrafts[tax.id] ?? "",
                                    0,
                                  ),
                                }
                              : t,
                          ),
                        )
                      }
                      placeholder="%"
                      className="w-20 shrink-0"
                    />
                    <Switch
                      className="ml-auto sm:ml-0"
                      checked={tax.enabled}
                      onCheckedChange={(v) =>
                        set(
                          "customTaxes",
                          settings.customTaxes.map((t) =>
                            t.id === tax.id ? { ...t, enabled: v } : t,
                          ),
                        )
                      }
                      aria-label={`Toggle ${tax.label || "tax"}`}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        set(
                          "customTaxes",
                          settings.customTaxes.filter((t) => t.id !== tax.id),
                        )
                      }
                      aria-label={`Remove ${tax.label || "tax"}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2 border-t pt-4">
            <p className="micro-label">Bill numbering</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Invoice prefix</Label>
                <Input
                  value={billPrefixDraft}
                  onChange={(e) =>
                    setBillPrefixDraft(
                      e.target.value.replace(/\s/g, "").slice(0, 10),
                    )
                  }
                  onBlur={() => {
                    const prefix = billPrefixDraft.trim();
                    if (!prefix) {
                      setBillPrefixDraft(settings.billPrefix);
                      toast.error("Prefix cannot be empty");
                      return;
                    }
                    set("billPrefix", prefix);
                  }}
                  placeholder="INV-"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Starting number</Label>
                <Input
                  inputMode="numeric"
                  value={billStartDraft}
                  onChange={(e) => setBillStartDraft(e.target.value)}
                  onBlur={() =>
                    set(
                      "billStartNo",
                      Math.floor(
                        boundedNumber(billStartDraft, 1, 1, 9_999_999),
                      ),
                    )
                  }
                  placeholder="1"
                />
              </div>
            </div>
            <div className="frost-well rounded-xl p-3 text-xs text-muted-foreground">
              Next bill:&nbsp;
              <span className="stat-value font-mono text-sm text-foreground">
                {formatInvoiceNo(settings.billPrefix, settings.billStartNo)}
              </span>
              &nbsp;— applies to new bills only; existing invoice numbers are
              unchanged.
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
