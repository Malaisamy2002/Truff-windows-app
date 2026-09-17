import { describe, expect, it } from "vitest";

import {
  DEFAULT_PRINT_SETTINGS,
  DENSITY_OPTIONS,
  LINE_SPACING_OPTIONS,
  PAPER_TYPES,
  PRINT_METHOD_OPTIONS,
  PRINTER_PRESETS,
  isRollPaper,
  normalizePrintSettings,
  paperInfo,
  paperWidthMm,
  type PaperId,
} from "./print";

/**
 * Every paper option a person can pick in Settings must (a) resolve back to
 * itself with its documented name/width, and (b) actually be "roll" or
 * "sheet" as advertised — that classification is what drives every scaling
 * decision in receipt.ts (font size, margins, fixed vs. growing page
 * height). A wrong id -> kind mapping here is exactly the kind of "letter
 * plan prints at the wrong scale" bug this suite is meant to catch.
 */

const EXPECTED_PAPERS: Record<
  PaperId,
  { label: string; widthMm: number; kind: "roll" | "sheet" }
> = {
  "50mm": { label: 'Thermal 2" (50 mm)', widthMm: 50, kind: "roll" },
  "58mm": { label: "Thermal 58 mm", widthMm: 58, kind: "roll" },
  "76mm": { label: 'Thermal 3" (76 mm)', widthMm: 76, kind: "roll" },
  "80mm": { label: "Thermal 80 mm (default)", widthMm: 80, kind: "roll" },
  custom: { label: "Custom thermal width…", widthMm: 80, kind: "roll" },
  a5: { label: "A5 sheet", widthMm: 148, kind: "sheet" },
  a4: { label: "A4 sheet", widthMm: 210, kind: "sheet" },
  letter: { label: "Letter sheet (US)", widthMm: 215.9, kind: "sheet" },
};

describe("PAPER_TYPES catalogue — every option keeps its documented name", () => {
  it("has exactly the paper ids the Settings screen offers, no more, no less", () => {
    expect(PAPER_TYPES.map((p) => p.id).sort()).toEqual(
      Object.keys(EXPECTED_PAPERS).sort(),
    );
  });

  for (const [id, expected] of Object.entries(EXPECTED_PAPERS)) {
    it(`"${id}" resolves to the label "${expected.label}" (${expected.kind})`, () => {
      const info = paperInfo(id as PaperId);
      expect(info.id).toBe(id);
      expect(info.label).toBe(expected.label);
      expect(info.widthMm).toBe(expected.widthMm);
      expect(info.kind).toBe(expected.kind);
    });
  }

  it("classifies exactly the four thermal widths + custom as roll paper", () => {
    const rollIds = PAPER_TYPES.filter((p) => isRollPaper(p.id)).map(
      (p) => p.id,
    );
    expect(rollIds.sort()).toEqual(
      ["50mm", "58mm", "76mm", "80mm", "custom"].sort(),
    );
  });

  it("classifies A5, A4 and Letter as sheet paper — never roll", () => {
    expect(isRollPaper("a5")).toBe(false);
    expect(isRollPaper("a4")).toBe(false);
    expect(isRollPaper("letter")).toBe(false);
  });

  it("A4 and Letter sheets each carry their OWN real height — never share a size", () => {
    const a4 = paperInfo("a4");
    const letter = paperInfo("letter");
    expect(a4.heightMm).toBe(297);
    expect(letter.heightMm).toBe(279.4);
    expect(a4.heightMm).not.toBe(letter.heightMm);
    expect(a4.widthMm).not.toBe(letter.widthMm);
  });

  it("falls back to 80mm thermal for an unknown/corrupted paper id", () => {
    // @ts-expect-error deliberately invalid id, simulating corrupted storage
    const info = paperInfo("not-a-real-paper");
    expect(info.id).toBe("80mm");
  });
});

describe("paperWidthMm() — the width actually used for scaling math", () => {
  it("uses the catalogue width for every fixed paper size", () => {
    expect(paperWidthMm({ paper: "58mm", customWidthMm: 999 })).toBe(58);
    expect(paperWidthMm({ paper: "a4", customWidthMm: 999 })).toBe(210);
    expect(paperWidthMm({ paper: "letter", customWidthMm: 999 })).toBe(215.9);
  });

  it("uses customWidthMm only when paper === 'custom'", () => {
    expect(paperWidthMm({ paper: "custom", customWidthMm: 72 })).toBe(72);
  });

  it("clamps a custom width into the sane 50-300mm printable range", () => {
    // Floor is 50mm, not narrower than any real hardware this app ships a
    // preset for — see the comment on paperWidthMm().
    expect(paperWidthMm({ paper: "custom", customWidthMm: 5 })).toBe(50);
    expect(paperWidthMm({ paper: "custom", customWidthMm: 5000 })).toBe(300);
  });

  it("falls back to 72mm for a missing/zero custom width", () => {
    expect(paperWidthMm({ paper: "custom", customWidthMm: 0 })).toBe(72);
  });
});

describe("PRINTER_PRESETS — every named preset points at a real paper option", () => {
  const validIds = new Set(PAPER_TYPES.map((p) => p.id));

  it("has a preset explicitly covering the Letter sheet plan", () => {
    const letterPreset = PRINTER_PRESETS.find((p) => p.id === "letter-sheet");
    expect(letterPreset).toBeDefined();
    expect(letterPreset?.label).toBe("Letter sheet (US office printer)");
    expect(letterPreset?.settings.paper).toBe("letter");
  });

  for (const preset of PRINTER_PRESETS) {
    it(`"${preset.id}" (${preset.label}) references a paper id that still exists`, () => {
      expect(preset.settings.paper).toBeDefined();
      expect(validIds.has(preset.settings.paper!)).toBe(true);
    });
  }

  it("has unique ids and unique labels — no duplicate preset shown twice", () => {
    const ids = PRINTER_PRESETS.map((p) => p.id);
    const labels = PRINTER_PRESETS.map((p) => p.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("DENSITY_OPTIONS / LINE_SPACING_OPTIONS — named correctly for the UI", () => {
  it("has exactly light/normal/dark, in that order", () => {
    expect(DENSITY_OPTIONS.map((d) => d.id)).toEqual([
      "light",
      "normal",
      "dark",
    ]);
  });

  it("has exactly compact/normal/relaxed, in that order", () => {
    expect(LINE_SPACING_OPTIONS.map((l) => l.id)).toEqual([
      "compact",
      "normal",
      "relaxed",
    ]);
  });
});

describe("DEFAULT_PRINT_SETTINGS — sane out-of-the-box scale", () => {
  it("defaults to the 80mm thermal roll at 1x font scale, 1 copy", () => {
    expect(DEFAULT_PRINT_SETTINGS.paper).toBe("80mm");
    expect(DEFAULT_PRINT_SETTINGS.fontScale).toBe(1);
    expect(DEFAULT_PRINT_SETTINGS.copies).toBe(1);
    expect(DEFAULT_PRINT_SETTINGS.templateStyle).toBe("premium");
  });

  it("keeps a positive, sane custom width even before anyone touches it", () => {
    expect(DEFAULT_PRINT_SETTINGS.customWidthMm).toBeGreaterThanOrEqual(50);
    expect(DEFAULT_PRINT_SETTINGS.customWidthMm).toBeLessThanOrEqual(300);
  });
});

describe("normalizePrintSettings()", () => {
  it("repairs malformed persisted values before the Settings controls use them", () => {
    const settings = normalizePrintSettings({
      paper: "unknown",
      copies: 99,
      customWidthMm: 10,
      density: "invalid",
      lineSpacing: "invalid",
    });

    expect(settings.paper).toBe("80mm");
    expect(settings.copies).toBe(5);
    expect(settings.customWidthMm).toBe(50);
    expect(settings.density).toBe("normal");
    expect(settings.lineSpacing).toBe("normal");
  });

  it("keeps the A4 letterhead clearance inside its safe range", () => {
    expect(normalizePrintSettings({ a4ContentTopMm: 2 }).a4ContentTopMm).toBe(
      40,
    );
    expect(normalizePrintSettings({ a4ContentTopMm: 500 }).a4ContentTopMm).toBe(
      140,
    );
  });

  it("exposes a named-printer print method alongside system and pdf", () => {
    expect(PRINT_METHOD_OPTIONS.map((o) => o.id)).toEqual([
      "system",
      "pdf",
      "named-printer",
    ]);
  });

  it("accepts named-printer as a valid printMethod and keeps the chosen printer", () => {
    const settings = normalizePrintSettings({
      printMethod: "named-printer",
      selectedPrinter: "Office HP LaserJet",
    });
    expect(settings.printMethod).toBe("named-printer");
    expect(settings.selectedPrinter).toBe("Office HP LaserJet");
  });

  it("falls back to an empty selected printer for malformed values", () => {
    expect(
      normalizePrintSettings({ selectedPrinter: 42 }).selectedPrinter,
    ).toBe("");
    expect(normalizePrintSettings({}).selectedPrinter).toBe(
      DEFAULT_PRINT_SETTINGS.selectedPrinter,
    );
  });

  it("rejects an unknown printMethod and keeps the previewBeforePrint migration working", () => {
    expect(normalizePrintSettings({ printMethod: "bogus" }).printMethod).toBe(
      DEFAULT_PRINT_SETTINGS.printMethod,
    );
    expect(
      normalizePrintSettings({ previewBeforePrint: true }).printMethod,
    ).toBe("pdf");
  });
});
