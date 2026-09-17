import { describe, expect, it } from "vitest";

import {
  backupAgeLabel,
  backupReminderDue,
  DEFAULT_APP_SETTINGS,
} from "./settings";

describe("backupAgeLabel()", () => {
  it("says never backed up when there's no timestamp", () => {
    expect(backupAgeLabel(null)).toBe("Never backed up");
  });

  it("says never backed up for an unparseable timestamp", () => {
    expect(backupAgeLabel("not-a-date")).toBe("Never backed up");
  });

  it("says just now for a backup seconds ago", () => {
    const now = new Date("2026-09-16T12:00:30.000Z");
    expect(backupAgeLabel("2026-09-16T12:00:00.000Z", now)).toBe(
      "Backed up just now",
    );
  });

  it("shows minutes for a backup under an hour ago", () => {
    const now = new Date("2026-09-16T12:45:00.000Z");
    expect(backupAgeLabel("2026-09-16T12:00:00.000Z", now)).toBe(
      "Backed up 45m ago",
    );
  });

  it("shows hours for a backup under a day ago", () => {
    const now = new Date("2026-09-16T18:00:00.000Z");
    expect(backupAgeLabel("2026-09-16T12:00:00.000Z", now)).toBe(
      "Backed up 6h ago",
    );
  });

  it("shows days for a backup under a week ago", () => {
    const now = new Date("2026-09-16T12:00:00.000Z");
    expect(backupAgeLabel("2026-09-14T12:00:00.000Z", now)).toBe(
      "Backed up 2d ago",
    );
  });

  it("falls back to a plain DD-MMM date once it's been a week or more, instead of an ever-growing day count", () => {
    const now = new Date("2026-09-16T12:00:00.000Z");
    expect(backupAgeLabel("2026-09-01T12:00:00.000Z", now)).toBe(
      "Backed up 01 Sep",
    );
  });

  it("includes the year when the backup falls in an earlier calendar year", () => {
    const now = new Date("2026-01-05T12:00:00.000Z");
    expect(backupAgeLabel("2025-12-01T12:00:00.000Z", now)).toBe(
      "Backed up 01 Dec 2025",
    );
  });

  it("treats a tiny clock-skew future timestamp as just now instead of a negative age", () => {
    const now = new Date("2026-09-16T12:00:00.000Z");
    expect(backupAgeLabel("2026-09-16T12:00:05.000Z", now)).toBe(
      "Backed up just now",
    );
  });
});

describe("backupReminderDue()", () => {
  it("is never due when reminders are off, no matter how old the backup is", () => {
    expect(
      backupReminderDue({
        ...DEFAULT_APP_SETTINGS,
        backupReminder: "off",
        lastBackupAt: null,
      }),
    ).toBe(false);
  });

  it("is due when a daily reminder has no backup on record at all", () => {
    expect(
      backupReminderDue({
        ...DEFAULT_APP_SETTINGS,
        backupReminder: "daily",
        lastBackupAt: null,
      }),
    ).toBe(true);
  });
});
