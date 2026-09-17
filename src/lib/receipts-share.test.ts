import { describe, expect, it } from "vitest";
import { resolveImportAction, sha256Hex } from "./receipts-share";

describe("resolveImportAction", () => {
  const known = new Set(["Receipts/2026-09-04/abc.jpg"]);

  it("restores a matched file that isn't already on this device", () => {
    expect(
      resolveImportAction("Receipts/2026-09-04/abc.jpg", known, false),
    ).toBe("restore");
  });

  it("skips a matched file that's already saved (never overwrite)", () => {
    expect(
      resolveImportAction("Receipts/2026-09-04/abc.jpg", known, true),
    ).toBe("skip-existing");
  });

  it("skips a file no current expense row points to, existing or not", () => {
    expect(
      resolveImportAction("Receipts/2026-09-04/orphan.jpg", known, false),
    ).toBe("skip-unmatched");
    expect(
      resolveImportAction("Receipts/2026-09-04/orphan.jpg", known, true),
    ).toBe("skip-unmatched");
  });
});

describe("sha256Hex()", () => {
  it("is deterministic for the same bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(await sha256Hex(bytes)).toBe(await sha256Hex(bytes.slice()));
  });

  it("differs for different bytes", async () => {
    const a = await sha256Hex(new Uint8Array([1, 2, 3]));
    const b = await sha256Hex(new Uint8Array([1, 2, 4]));
    expect(a).not.toBe(b);
  });
});
