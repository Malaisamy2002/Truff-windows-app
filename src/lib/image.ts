import type { StoredImage } from "./print";

/**
 * Sniffs the first few bytes of a file for a known image format's magic
 * number, independent of the browser-reported `File.type` (which is
 * inferred from the file's *extension*, not its contents — a renamed
 * `.exe` given a `.jpg` name is reported as `image/jpeg` by the browser).
 * Returns the sniffed MIME type, or `null` if the bytes don't match any
 * recognized image signature.
 *
 * Covers the formats this app can actually produce/accept: JPEG (from
 * camera captures and `compressReceiptImage`'s own output), PNG, WebP, GIF,
 * and HEIC/HEIF (some phone cameras save these directly). Deliberately
 * narrow — the goal is "is this actually a real image file", not
 * exhaustive format detection.
 */
export function sniffImageMimeType(bytes: Uint8Array): string | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  )
    return "image/png";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38)
    return "image/gif";
  if (
    at(0) === 0x52 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x46 &&
    at(8) === 0x57 &&
    at(9) === 0x45 &&
    at(10) === 0x42 &&
    at(11) === 0x50
  )
    return "image/webp";
  // HEIC/HEIF: ISO base media file format box at offset 4, "ftyp", with a
  // brand of heic/heix/hevc/hevx/mif1/msf1 at offset 8.
  if (at(4) === 0x66 && at(5) === 0x74 && at(6) === 0x79 && at(7) === 0x70) {
    const brand = String.fromCharCode(at(8), at(9), at(10), at(11));
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand))
      return "image/heic";
  }
  return null;
}

/**
 * Reads just enough of a File to sniff its signature (see
 * `sniffImageMimeType`) and reports whether it's a real image, without
 * reading/decoding the whole file.
 */
export async function isLikelyImageFile(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  return sniffImageMimeType(head) !== null;
}

/**
 * Reads an image File, downscales it to fit within `maxDim` on its longest
 * side (keeping aspect ratio), and returns a compact data URL + the final
 * pixel size. Used for logo/banner uploads in settings — full-resolution
 * photos would otherwise bloat localStorage and slow every PDF render.
 *
 * `maxDim` defaults to 480, which suits small crest logos and letterhead
 * banners. Full-bleed A4 background artwork needs a higher ceiling to stay
 * sharp when stretched across a whole printed page — callers pass a larger
 * value (see InvoiceBrandingCard's background/roll-header slots).
 */
export function readImageResized(
  file: File,
  maxDim = 480,
): Promise<StoredImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Not a valid image"));
      img.onload = () => {
        const scale = Math.min(
          1,
          maxDim / Math.max(img.naturalWidth, img.naturalHeight),
        );
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas not supported"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        // PNG keeps small crest logos/banners crisp (edges, transparency).
        // Above ~800px (full-bleed A4 backgrounds, thermal headers at high
        // res) a PNG gets big fast, so switch to JPEG — these are opaque
        // photo-like artwork anyway, and localStorage has a size ceiling.
        const large = maxDim > 800;
        resolve({
          dataUrl: large
            ? canvas.toDataURL("image/jpeg", 0.85)
            : canvas.toDataURL("image/png"),
          width,
          height,
        });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Downscales and re-encodes a receipt photo before it's stored.
 *
 * Camera captures from a modern phone commonly land at 3000-4000px on the
 * long edge and several MB each — fine for a handful of receipts, but at
 * the scale this app is meant for (tens of thousands of expense receipts
 * over the life of the business) that adds up to tens of gigabytes of
 * local storage and makes the standalone receipt-photo export/import in
 * #4 unworkable. Every receipt is resized to at most `maxDim` px on its
 * longest edge (default ~1400px — comfortably legible when zoomed in on a
 * phone, far below full camera resolution) and re-encoded as JPEG at
 * `quality` (default 0.7), which typically lands receipt photos in the
 * ~100-150KB range this app's storage math (`kathiresan-app` capacity
 * notes) assumes.
 *
 * Returns a new `File` with a `.jpg` name/type. If the input can't be
 * decoded as an image for any reason (corrupt file, unsupported format,
 * canvas unavailable), this resolves the *original* file unchanged rather
 * than rejecting — a failed compression attempt should never block saving
 * the expense itself.
 */
export function compressReceiptImage(
  file: File,
  maxDim = 1400,
  quality = 0.7,
): Promise<File> {
  return new Promise((resolve) => {
    const giveUp = () => resolve(file);
    if (!file.type.startsWith("image/")) {
      resolve(file);
      return;
    }
    // Compression is optional. A missing browser image API must never block
    // a receipt upload in a lightweight host or test environment.
    if (typeof FileReader === "undefined" || typeof Image === "undefined") {
      giveUp();
      return;
    }
    const reader = new FileReader();
    reader.onerror = giveUp;
    reader.onload = () => {
      const img = new Image();
      img.onerror = giveUp;
      img.onload = () => {
        try {
          const scale = Math.min(
            1,
            maxDim / Math.max(img.naturalWidth, img.naturalHeight),
          );
          const width = Math.max(1, Math.round(img.naturalWidth * scale));
          const height = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            giveUp();
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                giveUp();
                return;
              }
              const stem = file.name.replace(/\.[^./\\]+$/, "") || "receipt";
              resolve(new File([blob], `${stem}.jpg`, { type: "image/jpeg" }));
            },
            "image/jpeg",
            quality,
          );
        } catch {
          giveUp();
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
