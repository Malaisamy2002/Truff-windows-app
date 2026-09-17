import { describe, expect, it } from "vitest";

import { tabBalanceOf, tabKey, type TabEntry } from "./tabs";

const entry = (kind: "charge" | "payment", amount: number): TabEntry =>
  ({
    id: Math.random().toString(36).slice(2),
    tab_id: "t1",
    customer_key: "p:9876543210",
    kind,
    business: "Turf",
    amount,
    note: null,
    ref_type: null,
    ref_id: null,
    source_ref_type: null,
    source_ref_id: null,
    entry_date: "2026-09-01",
    created_at: "2026-09-01T00:00:00.000Z",
  }) as TabEntry;

describe("tabBalanceOf()", () => {
  it("is charges minus payments, in whole rupees", () => {
    expect(tabBalanceOf([entry("charge", 1200), entry("payment", 500)])).toBe(
      700,
    );
    expect(tabBalanceOf([entry("charge", 100.4), entry("charge", 100.4)])).toBe(
      200,
    );
    expect(tabBalanceOf([])).toBe(0);
  });

  it("goes to exactly 0 when settled in full (settle & close)", () => {
    const ledger = [entry("charge", 750), entry("charge", 499)];
    const balance = tabBalanceOf(ledger);
    // useSettleAndCloseTab writes one payment for the remaining balance.
    const settled = [...ledger, entry("payment", balance)];
    expect(tabBalanceOf(settled)).toBe(0);
  });

  it("shows over-collection as credit (negative balance), never as a due", () => {
    const ledger = [entry("charge", 500), entry("payment", 800)];
    expect(tabBalanceOf(ledger)).toBe(-300);
    // Dues screens clamp at 0 so credit can't cancel another customer's due.
    expect(Math.max(0, tabBalanceOf(ledger))).toBe(0);
  });

  it("re-opening a closed tab starts from the ledger it already had", () => {
    // Reopen only flips status; the balance stays derived from tab_entries.
    const settled = [entry("charge", 400), entry("payment", 400)];
    expect(tabBalanceOf(settled)).toBe(0);
    const afterReopenCharge = [...settled, entry("charge", 250)];
    expect(tabBalanceOf(afterReopenCharge)).toBe(250);
  });

  it("collecting more than once never drives a balance below the ledger sum", () => {
    const ledger = [
      entry("charge", 1000),
      entry("payment", 400),
      entry("payment", 600),
    ];
    expect(tabBalanceOf(ledger)).toBe(0);
  });
});

describe("tabKey()", () => {
  it("prefers the phone so a name typo lands on the same tab", () => {
    expect(tabKey("Ravi", "9876543210")).toBe(
      tabKey("Ravii", "+91 98765 43210"),
    );
  });

  it("falls back to the lowercased name without a usable phone", () => {
    expect(tabKey(" Ravi ", "123")).toBe("n:ravi");
  });
});
