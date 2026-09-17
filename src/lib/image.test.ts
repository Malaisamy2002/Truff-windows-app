import { describe, expect, it } from "vitest";

import {
  compressReceiptImage,
  isLikelyImageFile,
  sniffImageMimeType,
} from "./image";

describe("compressReceiptImage()", () => {
  it("passes non-image files through unchanged", async () => {
    // Guards the early-return branch: a corrupt/non-image File must never
    // reach FileReader/Image/canvas (unavailable outside a real browser,
    // and this app's test environment is plain Node — see theme.test.ts).
    const file = new File(["not a photo"], "notes.txt", { type: "text/plain" });
    const result = await compressReceiptImage(file);
    expect(result).toBe(file);
  });

  it("passes a file with no MIME type through unchanged", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "mystery.bin", {
      type: "",
    });
    const result = await compressReceiptImage(file);
    expect(result).toBe(file);
  });
});

describe("sniffImageMimeType()", () => {
  it("recognizes a JPEG signature", () => {
    expect(
      sniffImageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])),
    ).toBe("image/jpeg");
  });

  it("recognizes a PNG signature", () => {
    expect(
      sniffImageMimeType(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe("image/png");
  });

  it("recognizes a WebP signature", () => {
    // RIFF....WEBP
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(sniffImageMimeType(bytes)).toBe("image/webp");
  });

  it("returns null for a file whose extension/MIME claims image but whose bytes don't match any signature", () => {
    // e.g. a renamed .exe or plain text saved as "receipt.jpg" — the
    // browser's accept="image/*" filter is extension-based and would let
    // this through; the signature check must not.
    const bytes = new TextEncoder().encode("MZ\x90\x00 not actually a photo");
    expect(sniffImageMimeType(bytes)).toBeNull();
  });

  it("returns null for an empty/too-short buffer", () => {
    expect(sniffImageMimeType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("isLikelyImageFile()", () => {
  it("accepts a file with real JPEG bytes even if named oddly", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
    const file = new File([bytes], "whatever.dat", {
      type: "application/octet-stream",
    });
    expect(await isLikelyImageFile(file)).toBe(true);
  });

  it("rejects a renamed non-image file that a browser would report as image/jpeg by extension alone", async () => {
    const bytes = new TextEncoder().encode("not a real image, just renamed");
    const file = new File([bytes], "receipt.jpg", { type: "image/jpeg" });
    expect(await isLikelyImageFile(file)).toBe(false);
  });
});
