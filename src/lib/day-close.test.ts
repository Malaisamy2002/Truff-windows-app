import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach } from "vitest";

import { closeDay, dayCloseVariance } from "./day-close";
import { db } from "./localdb";

const historyForDay = async (day: string) =>
  (await db.day_close_history.where("day").equals(day).toArray()).sort((a, b) =>
    a.amended_at.localeCompare(b.amended_at),
  );

describe("dayCloseVariance()", () => {
  it("is positive when the drawer has more than expected", () => {
    expect(dayCloseVariance(1000, 1050)).toBe(50);
  });

  it("is negative for a shortfall", () => {
    expect(dayCloseVariance(1000, 950)).toBe(-50);
  });

  it("is zero when the count matches exactly", () => {
    expect(dayCloseVariance(1000, 1000)).toBe(0);
  });

  it("rounds each side to a whole rupee before diffing, like every other amount", () => {
    expect(dayCloseVariance(999.6, 1000.4)).toBe(0); // 1000 - 1000
  });
});

describe("closeDay()", () => {
  beforeEach(async () => {
    await db.day_closes.clear();
    await db.day_close_history.clear();
  });

  it("saves a new close-out record for a day with no prior close", async () => {
    const saved = await closeDay({
      day: "2026-09-16",
      expectedInDrawer: 4200,
      countedCash: 4150,
      note: "50 short, gave change for a torn note",
    });

    expect(saved.day).toBe("2026-09-16");
    expect(saved.expectedInDrawer).toBe(4200);
    expect(saved.countedCash).toBe(4150);
    expect(saved.variance).toBe(-50);
    expect(saved.note).toBe("50 short, gave change for a torn note");

    const rows = await db.day_closes.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(saved.id);
  });

  it("amends the existing record instead of duplicating when the same day is closed again", async () => {
    const first = await closeDay({
      day: "2026-09-16",
      expectedInDrawer: 4200,
      countedCash: 4000,
    });
    expect(first.variance).toBe(-200);

    const second = await closeDay({
      day: "2026-09-16",
      expectedInDrawer: 4200,
      countedCash: 4200,
      note: "recount was correct",
    });

    expect(second.id).toBe(first.id);
    expect(second.variance).toBe(0);
    expect(second.note).toBe("recount was correct");

    const rows = await db.day_closes.toArray();
    expect(rows).toHaveLength(1); // amended, not duplicated
  });

  it("keeps closing different days as separate records", async () => {
    await closeDay({
      day: "2026-09-15",
      expectedInDrawer: 100,
      countedCash: 100,
    });
    await closeDay({
      day: "2026-09-16",
      expectedInDrawer: 200,
      countedCash: 190,
    });

    const rows = await db.day_closes.toArray();
    expect(rows).toHaveLength(2);
  });

  it("stores an empty/whitespace note as null, matching the rest of the app's optional-note convention", async () => {
    const saved = await closeDay({
      day: "2026-09-17",
      expectedInDrawer: 100,
      countedCash: 100,
      note: "   ",
    });
    expect(saved.note).toBeNull();
  });

  it("preserves the original created_at across an amendment but refreshes closed_at", async () => {
    const first = await closeDay({
      day: "2026-09-16",
      expectedInDrawer: 100,
      countedCash: 100,
    });
    const firstRow = await db.day_closes.get(first.id);

    // Simulate the amendment happening a moment later.
    await new Promise((r) => setTimeout(r, 2));
    const second = await closeDay({
      day: "2026-09-16",
      expectedInDrawer: 100,
      countedCash: 90,
    });
    const secondRow = await db.day_closes.get(second.id);

    expect(secondRow?.created_at).toBe(firstRow?.created_at);
    expect(secondRow?.closed_at).not.toBe(firstRow?.closed_at);
  });

  it("does not write a history row for the first close of a day", async () => {
    await closeDay({
      day: "2026-09-16",
      expectedInDrawer: 100,
      countedCash: 100,
    });
    expect(await historyForDay("2026-09-16")).toHaveLength(0);
  });

  it("captures the pre-amendment values in day_close_history, not the new ones", async () => {
    await closeDay({
      day: "2026-09-16",
      expectedInDrawer: 4200,
      countedCash: 4000,
      note: "first count",
    });
    await closeDay({
      day: "2026-09-16",
      expectedInDrawer: 4200,
      countedCash: 4200,
      note: "recount was correct",
    });

    const history = await historyForDay("2026-09-16");
    expect(history).toHaveLength(1);
    expect(history[0]?.previous_counted_cash).toBe(4000);
    expect(history[0]?.previous_variance).toBe(-200);
    expect(history[0]?.previous_note).toBe("first count");

    // The live record now holds the new values, not the amended-away ones.
    const current = await db.day_closes
      .where("day")
      .equals("2026-09-16")
      .first();
    expect(current?.counted_cash).toBe(4200);
  });

  it("appends a new history row per amendment rather than overwriting the log", async () => {
    await closeDay({
      day: "2026-09-16",
      expectedInDrawer: 100,
      countedCash: 100,
    });
    await closeDay({
      day: "2026-09-16",
      expectedInDrawer: 100,
      countedCash: 90,
    });
    await closeDay({
      day: "2026-09-16",
      expectedInDrawer: 100,
      countedCash: 95,
    });

    const history = await historyForDay("2026-09-16");
    expect(history).toHaveLength(2);
    expect(history[0]?.previous_counted_cash).toBe(100);
    expect(history[1]?.previous_counted_cash).toBe(90);
  });

  it("keeps each day's amendment history separate", async () => {
    await closeDay({
      day: "2026-09-15",
      expectedInDrawer: 100,
      countedCash: 100,
    });
    await closeDay({
      day: "2026-09-15",
      expectedInDrawer: 100,
      countedCash: 90,
    });
    await closeDay({
      day: "2026-09-16",
      expectedInDrawer: 200,
      countedCash: 200,
    });

    expect(await historyForDay("2026-09-15")).toHaveLength(1);
    expect(await historyForDay("2026-09-16")).toHaveLength(0);
  });
});
