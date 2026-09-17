import { useRef } from "react";
import { toast } from "sonner";
import { ImageIcon, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { readImageResized } from "@/lib/image";
import { usePrintSettings, type StoredImage } from "@/lib/print";
import { SectionHeading } from "./SectionHeading";
import { SettingsSwitchRow } from "./SettingsField";

function ImageSlot({
  label,
  hint,
  value,
  onUpload,
  onRemove,
  maxDim = 480,
}: {
  label: string;
  hint: string;
  value: StoredImage;
  onUpload: (img: StoredImage) => void;
  onRemove: () => void;
  /** Longest-side pixel ceiling for this slot. Bumped above 480 for
   * full-page/full-width artwork (A4 background, thermal roll header) so it
   * stays sharp at print size — see readImageResized. */
  maxDim?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    try {
      const img = await readImageResized(file, maxDim);
      onUpload(img);
      toast.success(`${label} updated`);
    } catch {
      toast.error("Couldn't read that image");
    }
  };

  return (
    <div className="space-y-2">
      <Label className="micro-label">{label}</Label>
      <div className="frost-soft flex items-start gap-3 rounded-xl border p-3">
        <div className="frost-well flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg">
          {value ? (
            <img
              src={value.dataUrl}
              alt={label}
              className="h-full w-full object-contain"
            />
          ) : (
            <ImageIcon className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs text-muted-foreground">{hint}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="mr-1 h-3.5 w-3.5" />{" "}
              {value ? "Replace" : "Upload"}
            </Button>
            {value && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onRemove}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
              </Button>
            )}
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

/** Logo + banner + business name used to brand every generated bill (PDF,
 * print, WhatsApp). Stored alongside the rest of the print/receipt settings
 * so receipt.ts's buildReceiptPdf has one place to read branding from. */
export function InvoiceBrandingCard() {
  const { settings, save } = usePrintSettings();
  const set = <K extends keyof typeof settings>(
    k: K,
    v: (typeof settings)[K],
  ) => save({ ...settings, [k]: v });

  return (
    <section className="space-y-3">
      <SectionHeading
        eyebrow="BRANDING"
        title="Invoice generator"
        icon={ImageIcon}
      />
      <Card className="frost">
        <CardContent className="space-y-4 p-4">
          <div className="space-y-1">
            <Label className="micro-label">Business name</Label>
            <Input
              value={settings.shopName}
              onChange={(e) => set("shopName", e.target.value)}
              placeholder="e.g. Chennai Soccer School"
            />
            <p className="text-xs text-muted-foreground">
              Shown on every bill, receipt and printout. Leave blank to use the
              app default.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <ImageSlot
              label="Logo"
              hint="Square crest used on thermal receipts and as the invoice header icon."
              value={settings.logo}
              onUpload={(img) => set("logo", img)}
              onRemove={() => set("logo", null)}
            />
            <ImageSlot
              label="Banner"
              hint="Wide letterhead image used at the top of A5/A4 sheet invoices when there's no full-page background below."
              value={settings.banner}
              onUpload={(img) => set("banner", img)}
              onRemove={() => set("banner", null)}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <ImageSlot
              label="Full-page background (A4)"
              hint="Full-bleed A4 letterhead with header and footer baked in. Takes over the whole page on A4 bills, replacing the banner and the plain-text shop header/footer."
              value={settings.background}
              onUpload={(img) => set("background", img)}
              onRemove={() => set("background", null)}
              maxDim={1800}
            />
            <ImageSlot
              label="Thermal receipt header"
              hint="Full-width artwork (name/address/phone/BILL title) for the top of 80mm-style thermal receipts, replacing the logo and plain-text header on roll paper."
              value={settings.rollHeader}
              onUpload={(img) => set("rollHeader", img)}
              onRemove={() => set("rollHeader", null)}
              maxDim={900}
            />
          </div>

          <SettingsSwitchRow
            label="Show logo/banner/background on generated bills"
            hint="Turn off to fall back to plain text headers without removing the uploaded images."
            checked={settings.showLogo}
            onCheckedChange={(v) => set("showLogo", v)}
          />
        </CardContent>
      </Card>
    </section>
  );
}
