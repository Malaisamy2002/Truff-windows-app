import { describe, expect, it } from "vitest";

import {
  describeInvalidRows,
  findInvalidPhotoRows,
  findInvalidReceiptHashRows,
  findInvalidRows,
} from "./backup-validate";
import { DATA_TABLES } from "./localdb";

// Same idiom backup.test.ts already uses for an all-tables-present stub.
const emptyTables = (): Record<string, unknown[]> =>
  Object.fromEntries(DATA_TABLES.map((t) => [t, []]));

describe("findInvalidRows()", () => {
  it("reports nothing for an all-empty table set", () => {
    expect(findInvalidRows(emptyTables())).toEqual([]);
  });

  it("accepts a structurally sound row", () => {
    const tables = emptyTables();
    tables["customers"] = [
      { id: "c1", name: "Ravi", phone: null, created_at: "2026-09-04" },
    ];
    tables["expenses"] = [
      {
        id: "e1",
        business: "Turf",
        category: "Maintenance",
        amount: 100,
        spent_at: "2026-09-04",
      },
    ];
    expect(findInvalidRows(tables)).toEqual([]);
  });

  it("accepts a structurally sound day_closes row", () => {
    const tables = emptyTables();
    tables["day_closes"] = [
      {
        id: "dc1",
        day: "2026-09-16",
        expected_in_drawer: 4200,
        counted_cash: 4150,
        variance: -50,
        note: null,
        closed_at: "2026-09-16T14:00:00.000Z",
        created_at: "2026-09-16T14:00:00.000Z",
      },
    ];
    expect(findInvalidRows(tables)).toEqual([]);
  });

  it("flags a day_closes row missing its variance", () => {
    const tables = emptyTables();
    tables["day_closes"] = [
      {
        id: "dc1",
        day: "2026-09-16",
        expected_in_drawer: 4200,
        counted_cash: 4150,
      },
    ];
    const problems = findInvalidRows(tables);
    expect(problems).toEqual([
      {
        table: "day_closes",
        index: 0,
        reason: expect.stringContaining("variance"),
      },
    ]);
  });

  it("accepts a structurally sound day_close_history row", () => {
    const tables = emptyTables();
    tables["day_close_history"] = [
      {
        id: "dch1",
        day: "2026-09-16",
        previous_expected_in_drawer: 4200,
        previous_counted_cash: 4000,
        previous_variance: -200,
        previous_note: null,
        previous_closed_at: "2026-09-16T14:00:00.000Z",
        amended_at: "2026-09-16T15:00:00.000Z",
      },
    ];
    expect(findInvalidRows(tables)).toEqual([]);
  });

  it("flags a day_close_history row missing its previous_variance", () => {
    const tables = emptyTables();
    tables["day_close_history"] = [
      {
        id: "dch1",
        day: "2026-09-16",
        previous_expected_in_drawer: 4200,
        previous_counted_cash: 4000,
      },
    ];
    const problems = findInvalidRows(tables);
    expect(problems).toEqual([
      {
        table: "day_close_history",
        index: 0,
        reason: expect.stringContaining("previous_variance"),
      },
    ]);
  });

  it("flags a row missing its primary key", () => {
    const tables = emptyTables();
    tables["customers"] = [{ name: "No id" }];
    const problems = findInvalidRows(tables);
    expect(problems).toEqual([
      { table: "customers", index: 0, reason: expect.stringContaining("id") },
    ]);
  });

  it("flags a numeric field carrying the wrong type", () => {
    const tables = emptyTables();
    tables["expenses"] = [
      {
        id: "e1",
        business: "Turf",
        category: "Maintenance",
        amount: "100",
        spent_at: "2026-09-04",
      },
    ];
    const problems = findInvalidRows(tables);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.reason).toContain("amount");
  });

  it("flags NaN as an invalid number, not a valid one", () => {
    const tables = emptyTables();
    tables["expense_budgets"] = [{ id: "b1", month: "2026-09", amount: NaN }];
    const problems = findInvalidRows(tables);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.reason).toContain("amount");
  });

  it("flags a row that isn't an object at all", () => {
    const tables = emptyTables();
    tables["customers"] = [null];
    expect(findInvalidRows(tables)).toEqual([
      { table: "customers", index: 0, reason: "row is not an object" },
    ]);
  });

  it("flags an array (not a plain object) the same way as null", () => {
    const tables = emptyTables();
    tables["customers"] = [["not", "a", "row"]];
    expect(findInvalidRows(tables)).toEqual([
      { table: "customers", index: 0, reason: "row is not an object" },
    ]);
  });

  it("flags a field that should be an array but is an object", () => {
    const tables = emptyTables();
    tables["bills"] = [
      {
        id: "b1",
        invoice_no: "INV-1",
        items: { not: "an array" },
        subtotal: 100,
        total: 100,
        amount_paid: 100,
      },
    ];
    const problems = findInvalidRows(tables);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.reason).toContain("items");
  });

  it("does not require a field this table's checks don't cover (older-app rows still pass)", () => {
    // turf_bookings carries several optional fields (tax_amount, notes,
    // merged_into_bill_id, ...) that a row from an older app version simply
    // won't have — none of those are in this table's required-field list,
    // so a minimal-but-correct row still passes.
    const tables = emptyTables();
    tables["turf_bookings"] = [
      {
        id: "t1",
        booking_no: "INV-1",
        booking_date: "2026-09-04",
        hours: 1,
        rate_per_hour: 500,
        total_amount: 500,
        snacks: [],
      },
    ];
    expect(findInvalidRows(tables)).toEqual([]);
  });

  it("collects problems across multiple tables, not just the first one hit", () => {
    const tables = emptyTables();
    tables["customers"] = [{ name: "No id" }];
    tables["snack_combos"] = [{ id: "s1", name: "Combo" }]; // missing items/price
    const problems = findInvalidRows(tables);
    expect(problems.map((p) => p.table).sort()).toEqual([
      "customers",
      "snack_combos",
    ]);
  });

  it("reports one problem per bad row, not one per bad field", () => {
    const tables = emptyTables();
    // Missing id AND wrong-typed amount — should surface as ONE problem for
    // this row (the first field checked), not two.
    tables["expenses"] = [
      {
        business: "Turf",
        category: "Maintenance",
        amount: "bad",
        spent_at: "x",
      },
    ];
    expect(findInvalidRows(tables)).toHaveLength(1);
  });

  it("treats a missing table key the same as an empty array", () => {
    const tables = emptyTables();
    delete (tables as Record<string, unknown>)["customers"];
    expect(findInvalidRows(tables)).toEqual([]);
  });
});

describe("describeInvalidRows()", () => {
  it("summarizes counts per table in one line, and says nothing was restored", () => {
    const message = describeInvalidRows([
      { table: "customers", index: 0, reason: "x" },
      { table: "customers", index: 2, reason: "x" },
      { table: "expenses", index: 1, reason: "x" },
    ]);
    expect(message).toContain("3 row");
    expect(message).toContain("2 in customers");
    expect(message).toContain("1 in expenses");
    expect(message).toContain("nothing was restored");
  });

  it("uses singular phrasing for exactly one problem", () => {
    const message = describeInvalidRows([
      { table: "customers", index: 0, reason: "x" },
    ]);
    expect(message).toContain("1 row that");
    expect(message).not.toContain("1 rows");
  });
});

describe("findInvalidReceiptHashRows()", () => {
  it("accepts a well-shaped hash row", () => {
    expect(
      findInvalidReceiptHashRows([
        { path: "Receipts/2026-09-04/x.jpg", sha256: "abc123" },
      ]),
    ).toEqual([]);
  });

  it("flags a hash row missing sha256", () => {
    const problems = findInvalidReceiptHashRows([
      { path: "Receipts/2026-09-04/x.jpg" },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.reason).toContain("sha256");
  });

  it("flags a hash row that isn't an object", () => {
    expect(findInvalidReceiptHashRows(["not-a-row"])).toEqual([
      { index: 0, reason: "row is not an object" },
    ]);
  });
});

describe("findInvalidPhotoRows()", () => {
  it("accepts a well-shaped photo row", () => {
    expect(
      findInvalidPhotoRows([
        {
          path: "Receipts/2026-09-04/x.jpg",
          data: "base64==",
          created_at: "2026-09-04",
        },
      ]),
    ).toEqual([]);
  });

  it("flags a photo row with a non-string data field", () => {
    const problems = findInvalidPhotoRows([
      {
        path: "Receipts/2026-09-04/x.jpg",
        data: 12345,
        created_at: "2026-09-04",
      },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.reason).toContain("data");
  });
});
