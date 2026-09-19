import { describe, expect, it } from "vitest";

import { allocateWhole, money, rupees, splitHalf, sumRupees } from "./money";
import { rowTotal } from "./biz";
import { taxBreakdown } from "./settings";

const settings = (over: Partial<Parameters<typeof taxBreakdown>[1]> = {}) => ({
  gstEnabled: true,
  gstRate: 18,
  customTaxes: [],
  ...over,
});

describe("rupees()", () => {
  it("rounds to whole rupees, half away from zero", () => {
    expect(rupees(100.4)).toBe(100);
    expect(rupees(100.5)).toBe(101);
    expect(rupees(-100.5)).toBe(-101);
    expect(rupees("250.75")).toBe(251);
    expect(rupees(undefined)).toBe(0);
    expect(rupees(NaN)).toBe(0);
  });

  it("never leaves paise in a formatted amount", () => {
    expect(money(1234.56)).toBe("₹1,235");
    expect(money(0)).toBe("₹0");
    expect(money(-500.2)).toBe("-₹500");
  });

  it("sums each amount as a whole rupee", () => {
    expect(sumRupees([10.4, 10.4, 10.4])).toBe(30);
  });
});

describe("splitHalf()", () => {
  it("splits so both halves add back to the total exactly", () => {
    for (const total of [0, 1, 99, 100, 101, 4567]) {
      const [a, b] = splitHalf(total);
      expect(Number.isInteger(a)).toBe(true);
      expect(Number.isInteger(b)).toBe(true);
      expect(a + b).toBe(total);
    }
  });
});

describe("allocateWhole()", () => {
  it("rounds every share to a whole number and sums to the total", () => {
    const shares = [10.2, 10.2, 10.2, 10.2, 9.2]; // sums to 50.0
    const out = allocateWhole(shares);
    expect(out.every((v) => Number.isInteger(v))).toBe(true);
    expect(out.reduce((a, b) => a + b, 0)).toBe(50);
  });

  it("the 24-bucket case that motivated it: independent Math.round drifts, this doesn't", () => {
    // Same shape as turfOccupancy's byHour split: many fractional shares of
    // one whole-rupee total. Rounding each independently can miss the total
    // by a rupee or two; allocateWhole() must not.
    const shares = Array.from({ length: 24 }, (_, i) => 41.6 + (i % 3) * 0.3);
    const total = Math.round(shares.reduce((a, b) => a + b, 0));
    const out = allocateWhole(shares, total);
    expect(out.reduce((a, b) => a + b, 0)).toBe(total);
    // Every bucket stays within a rupee of its own raw share.
    for (let i = 0; i < shares.length; i++)
      expect(Math.abs(out[i]! - shares[i]!)).toBeLessThan(1.5);
  });

  it("stays exact for negative remainders too (a target below the floor sum)", () => {
    const shares = [5.9, 5.9, 5.9]; // floors sum to 15
    const out = allocateWhole(shares, 14); // target below even the floor sum
    expect(out.reduce((a, b) => a + b, 0)).toBe(14);
  });

  it("is a no-op shape for a single bucket — same as rupees()", () => {
    expect(allocateWhole([41.6])).toEqual([42]);
    expect(allocateWhole([41.4])).toEqual([41]);
  });

  it("handles an empty list", () => {
    expect(allocateWhole([])).toEqual([]);
  });
});

describe("rowTotal()", () => {
  it("is a whole rupee", () => {
    expect(rowTotal({ rate: 33.33, qty: 3 })).toBe(100);
    expect(rowTotal({ rate: 12.5, qty: 3 })).toBe(38);
  });
});

describe("taxBreakdown()", () => {
  it("charges tax on the taxable (post-discount) amount", () => {
    const { taxAmount } = taxBreakdown(1000, settings());
    expect(taxAmount).toBe(180);
  });

  it("returns whole-rupee lines that add up to taxAmount", () => {
    const { taxAmount, lines } = taxBreakdown(1017, settings());
    expect(lines.every((l) => Number.isInteger(l.value))).toBe(true);
    expect(lines.reduce((s, l) => s + l.value, 0)).toBe(taxAmount);
  });

  it("splits GST into CGST + SGST that sum exactly to the GST amount", () => {
    const { taxAmount, lines } = taxBreakdown(561, settings());
    const [cgst, sgst] = lines.map((l) => l.value);
    expect(cgst! + sgst!).toBe(taxAmount);
  });

  it("CGST always equals SGST, even when the combined GST would round to an odd rupee", () => {
    // Each half must be rounded independently (a hard GST-portal rule) —
    // splitting one pre-rounded combined figure in half can silently
    // produce CGST != SGST whenever that figure is odd. Sweep enough
    // taxable amounts and rates to hit that odd-rupee case repeatedly.
    for (const rate of [5, 12, 18, 28]) {
      for (let taxable = 1; taxable <= 500; taxable++) {
        const { lines } = taxBreakdown(taxable, settings({ gstRate: rate }));
        const [cgst, sgst] = lines.map((l) => l.value);
        expect(cgst).toBe(sgst);
      }
    }
  });

  it("adds custom taxes as their own rounded lines", () => {
    const { taxAmount, lines } = taxBreakdown(
      1000,
      settings({
        customTaxes: [{ id: "t1", label: "Service", rate: 5, enabled: true }],
      }),
    );
    expect(taxAmount).toBe(230);
    expect(lines.at(-1)).toEqual({ label: "Service @5%", value: 50 });
  });

  it("contributes nothing when every tax is off", () => {
    const { taxAmount, lines } = taxBreakdown(
      1000,
      settings({ gstEnabled: false }),
    );
    expect(taxAmount).toBe(0);
    expect(lines).toEqual([]);
  });
});
