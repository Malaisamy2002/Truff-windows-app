import { describe, expect, it } from "vitest";

import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from "./settings";

describe("normalizeAppSettings()", () => {
  it("restores missing lists and malformed values so Settings cards can render", () => {
    const settings = normalizeAppSettings({
      gstRate: "not-a-number",
      customTaxes: null,
      backupReminder: "monthly",
      billPrefix: "   ",
      billStartNo: 0,
    });

    expect(settings.gstRate).toBe(DEFAULT_APP_SETTINGS.gstRate);
    expect(settings.customTaxes).toEqual([]);
    expect(settings.backupReminder).toBe("off");
    expect(settings.billPrefix).toBe("INV-");
    expect(settings.billStartNo).toBe(1);
  });

  it("keeps only valid custom-tax rows", () => {
    const settings = normalizeAppSettings({
      customTaxes: [
        null,
        { id: "service", label: "Service Charge", rate: "5", enabled: true },
      ],
    });

    expect(settings.customTaxes).toEqual([
      { id: "service", label: "Service Charge", rate: 5, enabled: true },
    ]);
  });
});
