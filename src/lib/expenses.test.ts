import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach } from "vitest";

import {
  deleteReceipt,
  missingReceiptMessage,
  openReceipt,
  planRecurringPosts,
  RECEIPT_NOT_FOUND_MESSAGE,
  uploadReceipt,
  type RecurringExpense,
} from "./expenses";
import { db } from "./localdb";

const rule = (over: Partial<RecurringExpense> = {}): RecurringExpense => ({
  id: Math.random().toString(36).slice(2),
  title: "Net repair",
  business: "Turf",
  category: "Equipment",
  amount: 500,
  day_of_month: 5,
  is_active: true,
  last_posted_month: null,
  ...over,
});

describe("planRecurringPosts()", () => {
  it("posts an active rule once its day has arrived in the IST month", () => {
    // 2026-09-06 12:00 IST = 06:30 UTC
    const now = new Date("2026-09-06T06:30:00.000Z");
    const plan = planRecurringPosts([rule({ day_of_month: 5 })], now);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.spent_at).toBe("2026-09-05");
  });

  it("waits until the rule's day of month", () => {
    const now = new Date("2026-09-04T06:30:00.000Z"); // Sep 4 IST
    expect(planRecurringPosts([rule({ day_of_month: 5 })], now)).toHaveLength(
      0,
    );
  });

  it("stores a plain YYYY-MM-DD date, never a UTC timestamp", () => {
    // Regression: auto-posted rows used to store spent.toISOString(), so
    // plain-date equality filters (day filter, receipt folder) never matched.
    const now = new Date("2026-09-06T06:30:00.000Z");
    const plan = planRecurringPosts([rule()], now);
    expect(plan[0]?.spent_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses the IST day even when UTC is still on the previous day", () => {
    // 2026-09-01 02:00 IST is 2026-08-31 20:30 UTC: a rule for the 1st is due.
    const now = new Date("2026-08-31T20:30:00.000Z");
    const plan = planRecurringPosts([rule({ day_of_month: 1 })], now);
    expect(plan[0]?.spent_at).toBe("2026-09-01");
  });

  it("clamps the 31st to the last day of shorter months instead of rolling over", () => {
    // Feb 2026 has 28 days; new Date(y, m, 31) would roll into March.
    const now = new Date("2026-02-28T06:30:00.000Z"); // Feb 28 IST
    const plan = planRecurringPosts([rule({ day_of_month: 31 })], now);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.spent_at).toBe("2026-02-28");
  });

  it("does not roll the 31st into next month's key", () => {
    const now = new Date("2026-02-28T06:30:00.000Z");
    const plan = planRecurringPosts([rule({ day_of_month: 31 })], now);
    expect(plan[0]?.spent_at.startsWith("2026-02")).toBe(true);
  });

  it("skips rules already posted this month and inactive rules", () => {
    const now = new Date("2026-09-06T06:30:00.000Z");
    expect(
      planRecurringPosts([rule({ last_posted_month: "2026-09" })], now),
    ).toHaveLength(0);
    expect(planRecurringPosts([rule({ is_active: false })], now)).toHaveLength(
      0,
    );
  });

  it("posts again next month even after posting this month", () => {
    const now = new Date("2026-10-06T06:30:00.000Z");
    const plan = planRecurringPosts(
      [rule({ last_posted_month: "2026-09" })],
      now,
    );
    expect(plan[0]?.spent_at).toBe("2026-10-05");
  });
});

describe("uploadReceipt()", () => {
  beforeEach(async () => {
    await db.receipts.clear();
  });

  it("stores a real image and returns a Receipts/<date>/<id> path", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const file = new File([bytes], "photo.jpg", { type: "image/jpeg" });
    const path = await uploadReceipt(file, "2026-09-04");
    expect(path).toMatch(/^Receipts\/2026-09-04\/.+\.jpg$/);
    expect(await db.receipts.get(path)).toBeDefined();
  });

  it("rejects a renamed non-image file even though its extension/MIME says image", async () => {
    // The accept="image/*" file-picker filter and File.type are both
    // extension-derived and would let this through; uploadReceipt's own
    // signature check must not.
    const bytes = new TextEncoder().encode("definitely not a photo");
    const file = new File([bytes], "receipt.jpg", { type: "image/jpeg" });
    await expect(uploadReceipt(file, "2026-09-04")).rejects.toThrow(
      /doesn't look like an image/,
    );
    // And nothing should have been written to storage.
    expect(await db.receipts.toArray()).toHaveLength(0);
  });
});

describe("deleteReceipt()", () => {
  beforeEach(async () => {
    await db.receipts.clear();
    await db.receipt_hashes.clear();
  });

  it("removes both the photo and its recorded hash", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const file = new File([bytes], "photo.jpg", { type: "image/jpeg" });
    const path = await uploadReceipt(file, "2026-09-04");
    expect(await db.receipts.get(path)).toBeDefined();
    expect(await db.receipt_hashes.get(path)).toBeDefined();

    await deleteReceipt(path);
    expect(await db.receipts.get(path)).toBeUndefined();
    expect(await db.receipt_hashes.get(path)).toBeUndefined();
  });

  it("is a no-op for a path that was never stored", async () => {
    await expect(
      deleteReceipt("Receipts/2026-09-04/never-existed.jpg"),
    ).resolves.not.toThrow();
  });
});

describe("openReceipt() / missingReceiptMessage()", () => {
  it("throws RECEIPT_NOT_FOUND_MESSAGE when no photo is stored at the path", async () => {
    await expect(
      openReceipt("Receipts/2026-09-04/missing.jpg"),
    ).rejects.toThrow(RECEIPT_NOT_FOUND_MESSAGE);
  });

  it("names the reference number when the photo is missing", () => {
    const message = missingReceiptMessage(
      new Error(RECEIPT_NOT_FOUND_MESSAGE),
      "TX-20260904-0007",
    );
    expect(message).toContain("TX-20260904-0007");
    expect(message).not.toBe(RECEIPT_NOT_FOUND_MESSAGE);
  });

  it("points at a real restore path, not the removed .zip import feature", () => {
    // Regression: this used to say "Import receipts (.zip)", a feature that
    // no longer exists (see ReceiptsCard.tsx's removal) — a genuine dead
    // end for anyone who saw it.
    const message = missingReceiptMessage(
      new Error(RECEIPT_NOT_FOUND_MESSAGE),
      "TX-1",
    );
    expect(message).not.toContain(".zip");
    expect(message).not.toContain("Import receipts");
    expect(message).toMatch(/Backup & restore/);
  });

  it("falls back to a generic phrase when the expense has no reference number", () => {
    const message = missingReceiptMessage(
      new Error(RECEIPT_NOT_FOUND_MESSAGE),
      null,
    );
    expect(message).toContain("This receipt");
  });

  it("passes through any other error unchanged (not a missing-photo case)", () => {
    const message = missingReceiptMessage(
      new Error("Some other failure"),
      "TX-1",
    );
    expect(message).toBe("Some other failure");
  });
});
