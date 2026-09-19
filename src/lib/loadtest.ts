/**
 * Settings → Load test: a realistic, deterministic ONE-YEAR dataset.
 *
 * What it seeds (all tagged so it can be removed exactly):
 *  - 100 customers (`lt-cust-###`), reused by every booking / sale / bill.
 *  - 50 snack items (`lt-item-##`) that start at 100 stock and are actually
 *    depleted by the sales below, with a `snack_stock_history` row per
 *    change. Items are picked with a Pareto-ish popularity weighting (same
 *    idea as customer selection below) instead of uniformly at random, so
 *    a handful of fast movers actually run down to the low-stock threshold
 *    over a month instead of every one of the 50 items coasting near 100.
 *  - Turf bookings spread across SEVEN real hourly slots (11:30 AM → 6:30 PM)
 *    and LOAD_TEST_COURTS courts — never more bookings than courts per slot.
 *    Most are a single court for one hour, but a small share are a 2-court
 *    group booking, a 2-hour (two consecutive slots) booking, or both, so
 *    the multi-court / multi-hour paths (`courts` > 1, `hours` > 1) aren't
 *    only exercised by hand-written fixtures.
 *  - Varied offers (`discount`) and advances, so dues are a real spread.
 *  - Snack sales, merged-style bills and expenses across the same year.
 *    A small share of sales have no linked customer (`"Walk-in"`, the same
 *    convention `verificationSeed.ts` uses) and a small share of sales and
 *    bills are soft-voided (`cancelled: true` / `status: "cancelled"`) —
 *    a voided sale restores its items to stock, same as `useVoidSnackSale`.
 *  - GST 18% + a 5% service charge are switched on before seeding (same
 *    setup `verificationSeed.ts` audits against), and every booking/sale/
 *    bill is written with its tax frozen via `freezeTax()` — the same call
 *    real creation makes — so this dataset exercises the frozen-tax path,
 *    not just `grossWithTax()`'s live-recompute fallback for legacy rows.
 *  - On the LAST generated day, a handful of bills/bookings pushed onto the
 *    customer's running tab (Dues), so "Moved to dues" has seeded examples.
 *  - Two of the regular customers also get hand-placed tab activity spread
 *    earlier in the year: one is charged and pays it off in full (closing
 *    the tab), the other is charged and only partly pays — so the
 *    `"payment"` entry kind and tab-closing are covered, not just the
 *    `"charge"` rows the final-day push writes.
 *
 * Tagging: every document number starts with `LT-` and every row id with
 * `lt-`, so `clearLoadTestData()` removes exactly what a fresh seed writes —
 * nothing else is touched. Ids are counter-based (not random UUIDs) so two
 * runs produce a byte-identical dataset.
 *
 * Decisions made by this module (see the spec's open questions):
 *  - Target file is this one (loadtest.ts); verificationSeed.ts stays a small
 *    hand-auditable 2-month dataset.
 *  - The venue is seeded with 3 courts (LOAD_TEST_COURTS).
 *  - 6 records are pushed onto tabs on the final day (LAST_DAY_TAB_RECORDS).
 *  - The benchmark is a SINGLE-run result over the one seeded year (no
 *    year-over-year table).
 */

import {
  db,
  nowIso,
  resyncCounters,
  type BillRow,
  type CustomerRow,
  type CustomerTabRow,
  type ExpenseRow,
  type SnackItemRow,
  type SnackSaleRow,
  type SnackStockHistoryRow,
  type TabEntryRow,
  type TurfBookingRow,
} from "./localdb";
import { rupees } from "./money";
import { periodStats, type Sources } from "./analytics";
import { TAB_REF_BILL, TAB_REF_TURF_BOOKING, tabKey } from "./tabs";
import {
  buildReportPdf,
  type ReportPdfDoc,
  type ReportTable,
} from "./report-pdf";
import { currentYear } from "./years";
import { bookingTaxable, freezeTax } from "./biz";
import { readAppSettings, writeAppSettings } from "./settings";

/* ------------------------------------------------------------------ */
/* Tags, constants                                                      */
/* ------------------------------------------------------------------ */

export const LT_PREFIX = "LT-";
export const LT_ID = "lt-";
/** Courts the seeded venue has: a slot can hold at most this many bookings. */
export const LOAD_TEST_COURTS = 3;
/** How many of the final day's records are pushed onto customer tabs. */
export const LAST_DAY_TAB_RECORDS = 6;
export const LOAD_TEST_CUSTOMERS = 100;
export const LOAD_TEST_SNACK_ITEMS = 50;
export const LOAD_TEST_STOCK_START = 100;
/** Exactly one calendar year of data. */
export const LOAD_TEST_YEARS = 1;

/** The seven bookable hourly slots, in the same "h:mm AM/PM" label format
 * `minuteLabel()` (TimeSlotPicker) writes onto real bookings. */
export const LOAD_TEST_SLOTS: { start: string; end: string }[] = [
  { start: "11:30 AM", end: "12:30 PM" },
  { start: "12:30 PM", end: "1:30 PM" },
  { start: "1:30 PM", end: "2:30 PM" },
  { start: "2:30 PM", end: "3:30 PM" },
  { start: "3:30 PM", end: "4:30 PM" },
  { start: "4:30 PM", end: "5:30 PM" },
  { start: "5:30 PM", end: "6:30 PM" },
];

export type LoadTestMix = "light" | "medium";

export const LOAD_TEST_MIXES: Record<
  LoadTestMix,
  {
    label: string;
    occupancy: number;
    sales: number;
    bills: number;
    expenses: number;
  }
> = {
  // occupancy = share of the 7 slots × 3 courts filled on an average day.
  light: { label: "Light", occupancy: 0.35, sales: 4, bills: 1, expenses: 0.3 },
  medium: {
    label: "Medium",
    occupancy: 0.62,
    sales: 9,
    bills: 2,
    expenses: 0.6,
  },
};

/** Rough row estimate for the Settings card copy. */
export function estimatedRows(mix: LoadTestMix) {
  const m = LOAD_TEST_MIXES[mix];
  const days = 365;
  const bookings = Math.round(
    days * LOAD_TEST_SLOTS.length * LOAD_TEST_COURTS * m.occupancy,
  );
  const sales = Math.round(days * m.sales);
  return {
    customers: LOAD_TEST_CUSTOMERS,
    snackItems: LOAD_TEST_SNACK_ITEMS,
    bookings,
    sales,
    bills: Math.round(days * m.bills),
    expenses: Math.round(days * m.expenses),
    total:
      LOAD_TEST_CUSTOMERS +
      LOAD_TEST_SNACK_ITEMS +
      bookings +
      sales +
      Math.round(days * m.bills) +
      Math.round(days * m.expenses),
  };
}

/** The single calendar year the generator covers. */
export const loadTestYear = () => currentYear();

/* ------------------------------------------------------------------ */
/* Deterministic PRNG + id helpers                                      */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number, width = 5) => String(n).padStart(width, "0");

/* ------------------------------------------------------------------ */
/* Name / item catalogues                                              */
/* ------------------------------------------------------------------ */

const FIRST_NAMES = [
  "Arjun",
  "Vikram",
  "Rahul",
  "Sneha",
  "Priya",
  "Karthik",
  "Divya",
  "Sanjay",
  "Meera",
  "Aditya",
  "Nikhil",
  "Pooja",
  "Ramesh",
  "Anita",
  "Suresh",
  "Deepak",
  "Kavya",
  "Manoj",
  "Lakshmi",
  "Harish",
  "Ganesh",
  "Ritu",
  "Naveen",
  "Swathi",
  "Vishal",
  "Anjali",
  "Prakash",
  "Neha",
  "Kiran",
  "Gopal",
];

const SURNAMES = [
  "Sharma",
  "Reddy",
  "Nair",
  "Iyer",
  "Patel",
  "Kumar",
  "Menon",
  "Rao",
  "Verma",
  "Pillai",
  "Chopra",
  "Joshi",
  "Desai",
  "Bose",
  "Gupta",
  "Shetty",
  "Naidu",
  "Mehta",
  "Kulkarni",
  "Banerjee",
];

const SNACK_CATALOGUE: {
  name: string;
  category: string;
  price: number;
  cost: number;
}[] = [
  { name: "Tea", category: "Beverages", price: 15, cost: 7 },
  { name: "Coffee", category: "Beverages", price: 25, cost: 12 },
  { name: "Cold Coffee", category: "Beverages", price: 60, cost: 28 },
  { name: "Lemon Soda", category: "Beverages", price: 40, cost: 16 },
  { name: "Buttermilk", category: "Beverages", price: 25, cost: 10 },
  { name: "Lassi", category: "Beverages", price: 50, cost: 22 },
  { name: "Mineral Water 1L", category: "Beverages", price: 20, cost: 12 },
  { name: "Energy Drink", category: "Beverages", price: 90, cost: 60 },
  { name: "Cola 500ml", category: "Beverages", price: 45, cost: 30 },
  { name: "Orange Juice", category: "Beverages", price: 60, cost: 30 },
  { name: "Sugarcane Juice", category: "Beverages", price: 40, cost: 15 },
  { name: "Iced Tea", category: "Beverages", price: 50, cost: 20 },
  { name: "Masala Milk", category: "Beverages", price: 45, cost: 20 },
  { name: "Protein Shake", category: "Beverages", price: 120, cost: 70 },
  { name: "Electrolyte Bottle", category: "Beverages", price: 35, cost: 20 },
  { name: "Samosa", category: "Snacks", price: 20, cost: 8 },
  { name: "Veg Puff", category: "Snacks", price: 25, cost: 11 },
  { name: "Egg Puff", category: "Snacks", price: 30, cost: 14 },
  { name: "Masala Vada", category: "Snacks", price: 20, cost: 8 },
  { name: "Onion Pakoda", category: "Snacks", price: 40, cost: 16 },
  { name: "French Fries", category: "Snacks", price: 70, cost: 30 },
  { name: "Peri Peri Fries", category: "Snacks", price: 85, cost: 36 },
  { name: "Chicken Nuggets", category: "Snacks", price: 110, cost: 60 },
  { name: "Paneer Popcorn", category: "Snacks", price: 120, cost: 62 },
  { name: "Veg Sandwich", category: "Snacks", price: 60, cost: 26 },
  { name: "Grilled Cheese Sandwich", category: "Snacks", price: 80, cost: 38 },
  { name: "Chicken Sandwich", category: "Snacks", price: 100, cost: 52 },
  { name: "Veg Roll", category: "Snacks", price: 70, cost: 30 },
  { name: "Chicken Roll", category: "Snacks", price: 95, cost: 48 },
  { name: "Maggi Masala", category: "Snacks", price: 50, cost: 20 },
  { name: "Cheese Maggi", category: "Snacks", price: 70, cost: 30 },
  { name: "Bread Omelette", category: "Snacks", price: 55, cost: 24 },
  { name: "Boiled Corn Cup", category: "Snacks", price: 45, cost: 18 },
  { name: "Peanut Chaat", category: "Snacks", price: 35, cost: 14 },
  { name: "Pav Bhaji", category: "Snacks", price: 90, cost: 40 },
  { name: "Chips Packet", category: "Packaged", price: 20, cost: 14 },
  { name: "Nachos Packet", category: "Packaged", price: 40, cost: 26 },
  { name: "Biscuit Pack", category: "Packaged", price: 10, cost: 6 },
  { name: "Chocolate Bar", category: "Packaged", price: 50, cost: 35 },
  { name: "Protein Bar", category: "Packaged", price: 90, cost: 60 },
  { name: "Dry Fruit Mix", category: "Packaged", price: 70, cost: 45 },
  { name: "Ice Cream Cup", category: "Desserts", price: 40, cost: 18 },
  { name: "Choco Brownie", category: "Desserts", price: 65, cost: 28 },
  { name: "Gulab Jamun (2 pc)", category: "Desserts", price: 45, cost: 18 },
  { name: "Fruit Bowl", category: "Desserts", price: 60, cost: 30 },
  {
    name: "Match Combo (Tea + Samosa)",
    category: "Combos",
    price: 30,
    cost: 14,
  },
  {
    name: "Team Combo (6 Water + Fries)",
    category: "Combos",
    price: 180,
    cost: 100,
  },
  {
    name: "Evening Combo (Coffee + Puff)",
    category: "Combos",
    price: 45,
    cost: 21,
  },
  {
    name: "Kids Combo (Juice + Chips)",
    category: "Combos",
    price: 70,
    cost: 40,
  },
  {
    name: "Post-Match Combo (Shake + Roll)",
    category: "Combos",
    price: 200,
    cost: 112,
  },
];

const PAY_MODES = ["Cash", "UPI", "Card"];

/* ------------------------------------------------------------------ */
/* Seeding                                                              */
/* ------------------------------------------------------------------ */

export type SeedProgress = {
  /** 1-based month being written. */
  month: number;
  months: number;
  rows: number;
};

export type SeedResult = {
  year: number;
  customers: number;
  snackItems: number;
  bookings: number;
  sales: number;
  bills: number;
  expenses: number;
  tabEntries: number;
  stockHistory: number;
  total: number;
};

type Cust = { id: string; name: string; phone: string; weight: number };

function buildCustomers(rand: () => number): {
  rows: CustomerRow[];
  pick: () => Cust;
} {
  const created = `${loadTestYear() - 1}-12-01T04:00:00.000Z`;
  const list: Cust[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < LOAD_TEST_CUSTOMERS; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length]!;
    const last =
      SURNAMES[(i * 7 + Math.floor(i / SURNAMES.length)) % SURNAMES.length]!;
    let name = `${first} ${last}`;
    while (seen.has(name)) name = `${first} ${last} ${seen.size}`;
    seen.add(name);
    const lead = [9, 8, 7][i % 3]!;
    const phone = `${lead}${pad(100000000 + i * 1237, 9)}`.slice(0, 10);
    // Pareto-ish skew: the first customers are the regulars, the tail is rare.
    const weight = 1 / Math.pow(i + 1, 0.85);
    list.push({ id: `${LT_ID}cust-${pad(i, 3)}`, name, phone, weight });
  }
  const totalWeight = list.reduce((s, c) => s + c.weight, 0);
  const pick = () => {
    let r = rand() * totalWeight;
    for (const c of list) {
      r -= c.weight;
      if (r <= 0) return c;
    }
    return list[0]!;
  };
  const rows: CustomerRow[] = list.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    created_at: created,
  }));
  return { rows, pick };
}

function buildSnackItems(): SnackItemRow[] {
  const created = `${loadTestYear() - 1}-12-01T04:00:00.000Z`;
  return SNACK_CATALOGUE.slice(0, LOAD_TEST_SNACK_ITEMS).map((s, i) => ({
    id: `${LT_ID}item-${pad(i, 3)}`,
    item_name: s.name,
    category: s.category,
    unit_price: s.price,
    cost_price: s.cost,
    is_active: true,
    stock_quantity: LOAD_TEST_STOCK_START,
    low_stock_threshold: 15,
    created_at: created,
    stock_updated_at: created,
  }));
}

// The app's own bucketing (analytics.ts's monthKey/dayKey) reads bill_date
// as a UTC instant and adds back a fixed +5:30 IST offset to recover the
// IST calendar day/month — deliberately independent of whatever timezone
// the reading device happens to be in. isoAt() must produce a bill_date
// that actually IS that IST wall-clock moment; building it via
// `new Date(\`${date}T${hour}:${minute}:00\`).toISOString()` instead parses
// the string in the HOST MACHINE's local timezone, so it only comes out
// right when the seeding script happens to run on an IST-clocked machine.
// On a UTC-clocked machine (a CI runner, most dev laptops, this sandbox)
// every bill_date silently lands ~5.5h later than intended — enough to
// push month-end bills into the next month, or a Dec-31 bill into the
// next year entirely, outside the seeded one-year window.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const isoAt = (date: string, hour: number, minute = 0) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(
    Date.UTC(y, m - 1, d, hour, minute, 0) - IST_OFFSET_MS,
  ).toISOString();
};

const dateStr = (y: number, m: number, d: number) =>
  `${y}-${pad(m, 2)}-${pad(d, 2)}`;

/** Seeds exactly one calendar year, month by month (one transaction per
 * month) so the UI stays responsive and can report progress. */
export async function seedLoadTestData(
  mix: LoadTestMix = "light",
  onProgress?: (p: SeedProgress) => void,
): Promise<SeedResult> {
  const cfg = LOAD_TEST_MIXES[mix];
  const rand = mulberry32(20260903);
  const year = loadTestYear();

  // Match the tax setup `verificationSeed.ts`'s hand-computed expectations
  // use, so every generated row below can have its tax frozen via
  // freezeTax() (the frozen-tax path) instead of writing tax_amount: 0 and
  // only ever exercising grossWithTax()'s live-recompute fallback. Not
  // restored afterwards — same precedent as verificationSeed.ts, which also
  // leaves GST switched on once it seeds.
  const taxSettings = {
    ...readAppSettings(),
    gstEnabled: true,
    gstRate: 18,
    customTaxes: [
      { id: "svc", label: "Service Charge", rate: 5, enabled: true },
    ],
  };
  writeAppSettings(taxSettings);

  const { rows: customerRows, pick: pickCustomer } = buildCustomers(rand);
  const items = buildSnackItems();
  const stock = new Map(items.map((i) => [i.id, LOAD_TEST_STOCK_START]));
  // Pareto-ish popularity, same idea as buildCustomers()'s weighting: a few
  // fast-moving items (the front of SNACK_CATALOGUE — Tea, Coffee, Samosa…)
  // sell far more than the tail, so stock genuinely runs down to the
  // low-stock threshold on some items instead of every item coasting near
  // its starting 100 units all month.
  const itemWeights = items.map((_, i) => 1 / Math.pow(i + 1, 0.55));
  const itemWeightTotal = itemWeights.reduce((a, b) => a + b, 0);
  const pickItem = () => {
    let r = rand() * itemWeightTotal;
    for (let i = 0; i < items.length; i++) {
      r -= itemWeights[i]!;
      if (r <= 0) return items[i]!;
    }
    return items[0]!;
  };

  await db.transaction("rw", db.customers, db.snack_items, async () => {
    await db.customers.bulkPut(customerRows);
    await db.snack_items.bulkPut(items);
  });

  let seq = 0;
  let rowCount = customerRows.length + items.length;
  const counts = {
    bookings: 0,
    sales: 0,
    bills: 0,
    expenses: 0,
    stockHistory: 0,
    tabEntries: 0,
  };

  // Records written on the final day, candidates for the tab push in §7.
  let lastDayBills: BillRow[] = [];
  let lastDayBookings: TurfBookingRow[] = [];
  let lastDayCustomers = new Map<string, Cust>();

  for (let month = 1; month <= 12; month++) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const bookings: TurfBookingRow[] = [];
    const sales: SnackSaleRow[] = [];
    const bills: BillRow[] = [];
    const expenses: ExpenseRow[] = [];
    const history: SnackStockHistoryRow[] = [];
    const monthBillOwner = new Map<string, Cust>();
    const monthBookingOwner = new Map<string, Cust>();

    for (let day = 1; day <= daysInMonth; day++) {
      const date = dateStr(year, month, day);
      const dow = new Date(`${date}T00:00:00`).getDay();
      const weekend = dow === 0 || dow === 6;

      /* ---- turf bookings: real slots, capped by courts ---- */
      const busy = (weekend ? 1.25 : 0.9) * (0.75 + rand() * 0.6);
      // `${slotIndex}:${court}` cells already claimed by a booking — either
      // this slot's own loop iteration, or a multi-court / multi-hour
      // booking created a bit earlier that reaches forward into this cell.
      // Never exceeded LOAD_TEST_COURTS cells claimed per slot, same
      // invariant as before.
      const consumedCells = new Set<string>();
      for (let s = 0; s < LOAD_TEST_SLOTS.length; s++) {
        const slot = LOAD_TEST_SLOTS[s]!;
        // Evening slots fill first, late-morning slots stay quieter.
        const slotPull = 0.6 + (s / (LOAD_TEST_SLOTS.length - 1)) * 0.8;
        for (let court = 1; court <= LOAD_TEST_COURTS; court++) {
          const cellKey = `${s}:${court}`;
          if (consumedCells.has(cellKey)) continue;
          const chance =
            cfg.occupancy * busy * slotPull * (court === 1 ? 1 : 0.7);
          if (rand() > chance) continue;

          const cust = pickCustomer();
          const rate = weekend
            ? 1000 + Math.floor(rand() * 5) * 100
            : 700 + Math.floor(rand() * 4) * 100;

          // Group size: usually just this court, occasionally the group
          // also takes the next court(s) over (a bigger group booking).
          let courtsUsed = 1;
          while (
            courtsUsed < LOAD_TEST_COURTS - court + 1 &&
            !consumedCells.has(`${s}:${court + courtsUsed}`) &&
            rand() < 0.12
          ) {
            courtsUsed++;
          }

          // Duration: usually the one hourly slot, occasionally extended
          // into the next slot too (same court(s) must be free there).
          let hours = 1;
          if (
            s + 1 < LOAD_TEST_SLOTS.length &&
            rand() < (weekend ? 0.12 : 0.06)
          ) {
            let nextFree = true;
            for (let c = court; c < court + courtsUsed; c++) {
              if (consumedCells.has(`${s + 1}:${c}`)) nextFree = false;
            }
            if (nextFree) hours = 2;
          }
          for (let c = court; c < court + courtsUsed; c++) {
            consumedCells.add(`${s}:${c}`);
            if (hours === 2) consumedCells.add(`${s + 1}:${c}`);
          }

          const turfAmount = rupees(rate * hours * courtsUsed);
          // Offer: usually none, otherwise a 5–20% cut or a flat amount.
          const roll = rand();
          const discount =
            roll < 0.6
              ? 0
              : roll < 0.85
                ? rupees(turfAmount * (0.05 + rand() * 0.15))
                : 100;
          const total = Math.max(0, rupees(turfAmount - discount));
          const advanceFraction = [0, 0.3, 0.5, 0.7, 1][
            Math.floor(rand() * 5)
          ]!;
          const advance = rupees(total * advanceFraction);
          const status =
            rand() < 0.04
              ? "Cancelled"
              : rand() < 0.7
                ? "Completed"
                : "Confirmed";
          const tax = freezeTax(
            bookingTaxable({
              turf_amount: turfAmount,
              hours,
              rate_per_hour: rate,
              courts: courtsUsed,
              snacks_total: 0,
              discount,
              total_amount: total,
            }),
            taxSettings,
          );
          seq++;
          const id = `${LT_ID}bk-${pad(seq)}`;
          const row: TurfBookingRow = {
            id,
            booking_no: `${LT_PREFIX}TB-${pad(seq)}`,
            booking_date: date,
            customer_name: cust.name,
            phone: cust.phone,
            slot_name: weekend ? "Weekends" : "Weekdays",
            hours,
            rate_per_hour: rate,
            total_amount: total,
            tax_amount: tax.taxAmount,
            tax_lines: tax.taxLines,
            advance_paid: advance,
            payment_mode:
              advance > 0
                ? PAY_MODES[Math.floor(rand() * PAY_MODES.length)]!
                : "Pending",
            status,
            discount,
            notes: "load-test",
            start_time: slot.start,
            end_time: hours === 2 ? LOAD_TEST_SLOTS[s + 1]!.end : slot.end,
            courts: courtsUsed,
            snacks: [],
            snacks_total: 0,
            turf_amount: turfAmount,
            created_at: isoAt(date, 9, (s * 7 + court) % 60),
            merged_into_bill_id: null,
          };
          bookings.push(row);
          monthBookingOwner.set(id, cust);
        }
      }

      /* ---- snack sales: real items, real stock depletion ---- */
      const saleCount = Math.max(
        0,
        Math.round(cfg.sales * (weekend ? 1.4 : 1) * (0.6 + rand())),
      );
      for (let n = 0; n < saleCount; n++) {
        // ~10% of sales have no linked customer — a walk-in buying snacks
        // without a turf booking, same convention verificationSeed.ts uses
        // for its SB-0002 fixture. Previously every generated sale was
        // attached to one of the 100 seeded customers.
        const isWalkIn = rand() < 0.1;
        const cust = isWalkIn ? null : pickCustomer();
        const lineCount = 1 + Math.floor(rand() * 3);
        const lines: {
          item_name: string;
          qty: number;
          unit_price: number;
          cost_price: number;
          amount: number;
        }[] = [];
        let total = 0;
        let profit = 0;
        for (let l = 0; l < lineCount; l++) {
          const item = pickItem();
          const have = stock.get(item.id) ?? 0;
          if (have <= 0) continue;
          const qty = Math.min(have, 1 + Math.floor(rand() * 3));
          const amount = rupees(item.unit_price * qty);
          lines.push({
            item_name: item.item_name,
            qty,
            unit_price: item.unit_price,
            cost_price: item.cost_price,
            amount,
          });
          total += amount;
          profit += rupees((item.unit_price - item.cost_price) * qty);
          const next = have - qty;
          stock.set(item.id, next);
          history.push({
            id: `${LT_ID}sh-${pad(++seq)}`,
            item_id: item.id,
            item_name: item.item_name,
            delta: -qty,
            previous_quantity: have,
            new_quantity: next,
            created_at: isoAt(date, 13, (n * 3 + l) % 60),
          });
        }
        if (!lines.length) continue;
        // ~3% soft-voided: mirrors useVoidSnackSale — the sale stays as a
        // historical record (cancelled: true) but its items go straight
        // back on the shelf, with a stock-history row for the restock.
        const isCancelled = rand() < 0.03;
        if (isCancelled) {
          for (const line of lines) {
            const item = items.find((i) => i.item_name === line.item_name)!;
            const have = stock.get(item.id) ?? 0;
            const next = have + line.qty;
            stock.set(item.id, next);
            history.push({
              id: `${LT_ID}sh-${pad(++seq)}`,
              item_id: item.id,
              item_name: item.item_name,
              delta: line.qty,
              previous_quantity: have,
              new_quantity: next,
              created_at: isoAt(date, 14, (n * 3) % 60),
            });
          }
        }
        const tax = freezeTax(total, taxSettings);
        seq++;
        sales.push({
          id: `${LT_ID}sale-${pad(seq)}`,
          bill_no: `${LT_PREFIX}SB-${pad(seq)}`,
          sale_date: date,
          customer_name: cust ? cust.name : "Walk-in",
          items: lines,
          total: rupees(total),
          tax_amount: tax.taxAmount,
          tax_lines: tax.taxLines,
          profit: rupees(profit),
          payment_mode: PAY_MODES[Math.floor(rand() * PAY_MODES.length)]!,
          notes: "load-test",
          booking_id: null,
          booking_no: null,
          created_at: isoAt(date, 13, n % 60),
          merged_into_bill_id: null,
          ...(isCancelled ? { cancelled: true } : {}),
        });
      }

      /* ---- bills ---- */
      const billCount = Math.round(cfg.bills * (rand() < 0.5 ? 1 : 2));
      for (let n = 0; n < billCount; n++) {
        const cust = pickCustomer();
        const base = 400 + Math.floor(rand() * 18) * 100;
        const discount =
          rand() < 0.7 ? 0 : rupees(base * (0.05 + rand() * 0.15));
        const total = Math.max(0, rupees(base - discount));
        // ~3% cancelled bills — void, not unpaid (biz.ts's BillStatus):
        // excluded from dues, no amount ever collected against it.
        const isCancelled = rand() < 0.03;
        const payRoll = rand();
        const paid = isCancelled
          ? 0
          : payRoll < 0.5
            ? total
            : payRoll < 0.8
              ? rupees(total * (0.3 + rand() * 0.4))
              : 0;
        const status = isCancelled
          ? "cancelled"
          : paid >= total
            ? "paid"
            : paid > 0
              ? "partial"
              : "unpaid";
        const tax = freezeTax(total, taxSettings);
        seq++;
        const id = `${LT_ID}bill-${pad(seq)}`;
        const row: BillRow = {
          id,
          invoice_no: `${LT_PREFIX}INV-${pad(seq)}`,
          customer_name: cust.name,
          customer_phone: cust.phone,
          items: [
            {
              item: "Turf + snacks",
              rate: base,
              qty: 1,
              total: base,
              unit: "hr",
            },
          ],
          subtotal: base,
          discount,
          total,
          tax_amount: tax.taxAmount,
          tax_lines: tax.taxLines,
          amount_paid: status === "paid" ? 0 : paid,
          status,
          payment_mode:
            paid > 0 ? PAY_MODES[Math.floor(rand() * PAY_MODES.length)]! : null,
          bill_date: isoAt(date, 19, n % 60),
          created_at: isoAt(date, 19, n % 60),
        };
        bills.push(row);
        monthBillOwner.set(id, cust);
      }

      /* ---- expenses ---- */
      if (rand() < cfg.expenses) {
        // Real categories the app renders icons for (see CATEGORY_ICONS in
        // expenses.ts) — previously "maintenance"/"ingredients" didn't
        // match any of these (wrong case, and "ingredients" isn't a real
        // category at all), so every load-test expense fell back to the
        // generic "Other" icon regardless of its actual category text.
        const turfCategories = [
          "Maintenance",
          "Electricity",
          "Rent",
          "Staff Wages",
          "Equipment",
          "Transport",
          "Other",
        ];
        const snackCategories = [
          "Raw Material",
          "Staff Wages",
          "Electricity",
          "Transport",
          "Other",
        ];
        const business = rand() < 0.5 ? "Turf" : "Snacks";
        const categories =
          business === "Turf" ? turfCategories : snackCategories;
        seq++;
        expenses.push({
          id: `${LT_ID}exp-${pad(seq)}`,
          expense_no: `${LT_PREFIX}TX-${pad(seq)}`,
          business,
          category: categories[Math.floor(rand() * categories.length)]!,
          description: "Load test expense",
          note: null,
          amount: rupees(200 + rand() * 3000),
          spent_at: isoAt(date, 11, 0),
          receipt_path: null,
          created_at: isoAt(date, 11, 0),
        });
      }
    }

    /* ---- monthly restock of anything that ran low ---- */
    const restockDate = dateStr(year, month, daysInMonth);
    for (const item of items) {
      const have = stock.get(item.id) ?? 0;
      if (have > item.low_stock_threshold) continue;
      const next = LOAD_TEST_STOCK_START;
      stock.set(item.id, next);
      history.push({
        id: `${LT_ID}sh-${pad(++seq)}`,
        item_id: item.id,
        item_name: item.item_name,
        delta: next - have,
        previous_quantity: have,
        new_quantity: next,
        created_at: isoAt(restockDate, 20, 0),
      });
    }

    await db.transaction(
      "rw",
      db.turf_bookings,
      db.snack_sales,
      db.bills,
      db.expenses,
      db.snack_stock_history,
      async () => {
        if (bookings.length) await db.turf_bookings.bulkPut(bookings);
        if (sales.length) await db.snack_sales.bulkPut(sales);
        if (bills.length) await db.bills.bulkPut(bills);
        if (expenses.length) await db.expenses.bulkPut(expenses);
        if (history.length) await db.snack_stock_history.bulkPut(history);
      },
    );

    counts.bookings += bookings.length;
    counts.sales += sales.length;
    counts.bills += bills.length;
    counts.expenses += expenses.length;
    counts.stockHistory += history.length;
    rowCount +=
      bookings.length +
      sales.length +
      bills.length +
      expenses.length +
      history.length;

    if (month === 12) {
      // Keep the whole final month; §7 prefers the last day and falls back to
      // earlier December records when the day itself has too few candidates.
      lastDayBills = bills;
      lastDayBookings = bookings;
      lastDayCustomers = new Map([...monthBillOwner, ...monthBookingOwner]);
    }

    onProgress?.({ month, months: 12, rows: rowCount });
    // Yield to the UI between month chunks.
    await new Promise((r) => setTimeout(r, 0));
  }

  /* ---- persist final stock levels ---- */
  await db.transaction("rw", db.snack_items, async () => {
    for (const item of items) {
      await db.snack_items.update(item.id, {
        stock_quantity: stock.get(item.id) ?? 0,
        stock_updated_at: isoAt(dateStr(year, 12, 31), 20, 0),
      });
    }
  });

  /* ---- §7: push a handful of the final day's records onto tabs ---- */
  const lastDate = dateStr(year, 12, 31);
  const tabs = new Map<string, CustomerTabRow>();
  const entries: TabEntryRow[] = [];
  let tabSeq = 0;

  const chargeFor = (
    cust: Cust,
    amount: number,
    business: string,
    refType: string,
    refId: string,
  ) => {
    const value = rupees(amount);
    if (value <= 0) return;
    const key = tabKey(cust.name, cust.phone);
    let tab = tabs.get(key);
    if (!tab) {
      tab = {
        id: `${LT_ID}tab-${pad(tabs.size, 3)}`,
        customer_key: key,
        customer_name: cust.name,
        phone: cust.phone,
        status: "open",
        opened_at: isoAt(lastDate, 21, 0),
        closed_at: null,
        created_at: isoAt(lastDate, 21, 0),
      };
      tabs.set(key, tab);
    }
    entries.push({
      id: `${LT_ID}tabentry-${pad(++tabSeq, 3)}`,
      tab_id: tab.id,
      customer_key: key,
      kind: "charge",
      business,
      amount: value,
      note: "Load test — moved to dues",
      ref_type: refType,
      ref_id: refId,
      source_ref_type: null,
      source_ref_id: null,
      payment_mode: null,
      entry_date: lastDate,
      created_at: isoAt(lastDate, 21, 0),
    });
  };

  // Last-day records first, topped up from the rest of December when needed.
  const dayFirst = <T>(rows: T[], onDay: (r: T) => boolean) => [
    ...rows.filter(onDay),
    ...rows.filter((r) => !onDay(r)),
  ];
  const billCandidates = dayFirst(
    lastDayBills,
    (b) => b.created_at.slice(0, 10) === lastDate,
  ).filter(
    (b) =>
      b.status !== "paid" &&
      b.status !== "cancelled" &&
      b.total - b.amount_paid > 0,
  );
  const bookingCandidates = dayFirst(
    lastDayBookings,
    (b) => b.booking_date === lastDate,
  ).filter(
    (b) => b.status !== "Cancelled" && b.total_amount - b.advance_paid > 0,
  );
  const billsToTab = billCandidates.slice(
    0,
    Math.ceil(LAST_DAY_TAB_RECORDS / 2),
  );
  const bookingsToTab = bookingCandidates.slice(
    0,
    LAST_DAY_TAB_RECORDS - billsToTab.length,
  );

  for (const b of billsToTab) {
    const cust = lastDayCustomers.get(b.id);
    if (cust)
      chargeFor(cust, b.total - b.amount_paid, "Snacks", TAB_REF_BILL, b.id);
  }
  for (const b of bookingsToTab) {
    const cust = lastDayCustomers.get(b.id);
    if (cust)
      chargeFor(
        cust,
        b.total_amount - b.advance_paid,
        "Turf",
        TAB_REF_TURF_BOOKING,
        b.id,
      );
  }

  /* ---- §7b: hand-placed tab activity earlier in the year ----
   * §7 above only ever writes "charge" rows, all dated the final day — the
   * "payment" entry kind and tab-closing are never exercised by the
   * generated dataset. Two of the regular customers (customerRows[0]/[1],
   * the most-weighted — so also the customers most likely to show up
   * elsewhere in their own booking/sale history) get a small hand-placed
   * ledger instead: */
  const manualEntry = (
    cust: Pick<CustomerRow, "id" | "name" | "phone">,
    kind: "charge" | "payment",
    amount: number,
    business: string,
    date: string,
    note: string,
  ) => {
    const value = rupees(amount);
    if (value <= 0) return;
    const key = tabKey(cust.name, cust.phone);
    let tab = tabs.get(key);
    if (!tab) {
      tab = {
        id: `${LT_ID}tab-${pad(tabs.size, 3)}`,
        customer_key: key,
        customer_name: cust.name,
        phone: cust.phone,
        status: "open",
        opened_at: isoAt(date, 12, 0),
        closed_at: null,
        created_at: isoAt(date, 12, 0),
      };
      tabs.set(key, tab);
    }
    entries.push({
      id: `${LT_ID}tabentry-${pad(++tabSeq, 3)}`,
      tab_id: tab.id,
      customer_key: key,
      kind,
      business,
      amount: value,
      note,
      ref_type: null,
      ref_id: null,
      source_ref_type: null,
      source_ref_id: null,
      payment_mode: kind === "payment" ? "Cash" : null,
      entry_date: date,
      created_at: isoAt(date, 12, 0),
    });
  };

  const regular1 = customerRows[0]!;
  const regular2 = customerRows[1]!;

  // Regular #1: a manual due charged mid-year, paid off in full a week
  // later, tab explicitly closed — the ordinary "settle and close" flow.
  manualEntry(
    regular1,
    "charge",
    800,
    "Turf",
    dateStr(year, 6, 10),
    "Load test — manual due",
  );
  manualEntry(
    regular1,
    "payment",
    800,
    "Shared",
    dateStr(year, 6, 17),
    "Load test — settled",
  );
  const closedTab = tabs.get(tabKey(regular1.name, regular1.phone));
  if (closedTab) {
    closedTab.status = "closed";
    closedTab.closed_at = isoAt(dateStr(year, 6, 17), 12, 0);
  }

  // Regular #2: charged, then only PARTLY paid a couple of weeks later —
  // stays open with a real balance, separate from (and earlier than) the
  // Dec-31 "moved to dues" push, exercising the ordinary partial-payment
  // flow on its own.
  manualEntry(
    regular2,
    "charge",
    1200,
    "Snacks",
    dateStr(year, 3, 5),
    "Load test — manual due",
  );
  manualEntry(
    regular2,
    "payment",
    500,
    "Shared",
    dateStr(year, 3, 20),
    "Load test — part payment",
  );

  if (entries.length) {
    await db.transaction("rw", db.customer_tabs, db.tab_entries, async () => {
      await db.customer_tabs.bulkPut([...tabs.values()]);
      await db.tab_entries.bulkPut(entries);
    });
  }
  counts.tabEntries = entries.length;
  rowCount += entries.length + tabs.size;

  await resyncCounters();

  return {
    year,
    customers: customerRows.length,
    snackItems: items.length,
    ...counts,
    total: rowCount,
  };
}

/* ------------------------------------------------------------------ */
/* Counting + cleanup                                                   */
/* ------------------------------------------------------------------ */

const ltIds = <T extends { id: string }>(rows: T[]) =>
  rows.filter((r) => r.id.startsWith(LT_ID)).map((r) => r.id);

export type LoadTestCounts = {
  customers: number;
  snackItems: number;
  bookings: number;
  sales: number;
  bills: number;
  expenses: number;
  stockHistory: number;
  tabEntries: number;
  tabs: number;
  total: number;
};

export async function countLoadTestRows(): Promise<LoadTestCounts> {
  const [
    customers,
    items,
    bookings,
    sales,
    bills,
    expenses,
    history,
    entries,
    tabs,
  ] = await Promise.all([
    db.customers.toArray(),
    db.snack_items.toArray(),
    db.turf_bookings.toArray(),
    db.snack_sales.toArray(),
    db.bills.toArray(),
    db.expenses.toArray(),
    db.snack_stock_history.toArray(),
    db.tab_entries.toArray(),
    db.customer_tabs.toArray(),
  ]);
  const out: LoadTestCounts = {
    customers: ltIds(customers).length,
    snackItems: ltIds(items).length,
    bookings: ltIds(bookings).length,
    sales: ltIds(sales).length,
    bills: ltIds(bills).length,
    expenses: ltIds(expenses).length,
    stockHistory: ltIds(history).length,
    tabEntries: ltIds(entries).length,
    tabs: ltIds(tabs).length,
    total: 0,
  };
  out.total =
    out.customers +
    out.snackItems +
    out.bookings +
    out.sales +
    out.bills +
    out.expenses +
    out.stockHistory +
    out.tabEntries +
    out.tabs;
  return out;
}

/** Removes every row this module wrote — including the seeded customers,
 * snack items, stock history, tab entries and tabs — and nothing else. */
export async function clearLoadTestData(): Promise<LoadTestCounts> {
  const before = await countLoadTestRows();

  const wipe = async <T extends { id: string }>(
    read: () => Promise<T[]>,
    del: (ids: string[]) => Promise<unknown>,
  ) => {
    const ids = ltIds(await read());
    if (ids.length) await del(ids);
  };

  await wipe(
    () => db.turf_bookings.toArray(),
    (ids) => db.turf_bookings.bulkDelete(ids),
  );
  await wipe(
    () => db.snack_sales.toArray(),
    (ids) => db.snack_sales.bulkDelete(ids),
  );
  await wipe(
    () => db.bills.toArray(),
    (ids) => db.bills.bulkDelete(ids),
  );
  await wipe(
    () => db.expenses.toArray(),
    (ids) => db.expenses.bulkDelete(ids),
  );
  await wipe(
    () => db.snack_stock_history.toArray(),
    (ids) => db.snack_stock_history.bulkDelete(ids),
  );
  await wipe(
    () => db.snack_items.toArray(),
    (ids) => db.snack_items.bulkDelete(ids),
  );
  await wipe(
    () => db.customers.toArray(),
    (ids) => db.customers.bulkDelete(ids),
  );
  await wipe(
    () => db.tab_entries.toArray(),
    (ids) => db.tab_entries.bulkDelete(ids),
  );
  await wipe(
    () => db.customer_tabs.toArray(),
    (ids) => db.customer_tabs.bulkDelete(ids),
  );

  await resyncCounters();
  return before;
}

/* ------------------------------------------------------------------ */
/* Benchmark — a SINGLE run over the one seeded year                    */
/* ------------------------------------------------------------------ */

export type LoadTestBenchmark = {
  ranAt: string;
  year: number;
  rows: number;
  readMs: number;
  analyticsMs: number;
  pdfMs: number;
  totalMs: number;
};

const ms = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/**
 * Times the three things that get slow on a big dataset: reading the year
 * out of IndexedDB, running the dashboard/report analytics over it, and
 * building a report PDF from the result. One year in, one row of results out.
 */
export async function runLoadTestBenchmark(): Promise<LoadTestBenchmark> {
  const year = loadTestYear();
  const started = ms();

  const t0 = ms();
  const [bills, bookings, sales, expenses, tabEntries] = await Promise.all([
    db.bills.toArray(),
    db.turf_bookings.toArray(),
    db.snack_sales.toArray(),
    db.expenses.toArray(),
    db.tab_entries.toArray(),
  ]);
  const readMs = ms() - t0;

  const inYear = (iso: string) => String(iso).startsWith(String(year));
  const src = {
    bills,
    bookings,
    sales,
    expenses,
    tabEntries,
  } as unknown as Sources;

  const t1 = ms();
  const stats = periodStats(src, inYear);
  const analyticsMs = ms() - t1;

  const t2 = ms();
  buildReportPdf(benchmarkDoc(year, stats, 0, 0, 0));
  const pdfMs = ms() - t2;

  const rows =
    bills.length +
    bookings.length +
    sales.length +
    expenses.length +
    tabEntries.length;

  return {
    ranAt: nowIso(),
    year,
    rows,
    readMs: Math.round(readMs),
    analyticsMs: Math.round(analyticsMs),
    pdfMs: Math.round(pdfMs),
    totalMs: Math.round(ms() - started),
  };
}

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-IN")}`;

function benchmarkDoc(
  year: number,
  stats: ReturnType<typeof periodStats>,
  readMs: number,
  analyticsMs: number,
  pdfMs: number,
): ReportPdfDoc {
  const timings: ReportTable = {
    title: "Timings",
    columns: ["Step", "Time"],
    align: ["left", "right"],
    rows: [
      { cells: ["Read year from database", `${Math.round(readMs)} ms`] },
      { cells: ["Analytics over the year", `${Math.round(analyticsMs)} ms`] },
      { cells: ["Build report PDF", `${Math.round(pdfMs)} ms`] },
    ],
  };
  const totals: ReportTable = {
    title: `${year} totals`,
    columns: ["Figure", "Amount"],
    align: ["left", "right"],
    rows: [
      { cells: ["Revenue (gross)", rs(stats.revenue)] },
      { cells: ["Collected", rs(stats.collected)] },
      { cells: ["Expenses", rs(stats.expenses)] },
      { cells: ["Profit", rs(stats.profit)] },
      { cells: ["Outstanding dues", rs(stats.dues)], strong: true },
    ],
  };
  return {
    title: `Load test results — ${year}`,
    subtitle: `One year of generated data`,
    tables: [timings, totals],
    fileName: `load-test-${year}`,
  };
}

/** Printable results for the Settings card's "Results PDF" button. */
export function benchmarkPdfDoc(result: LoadTestBenchmark): ReportPdfDoc {
  const table: ReportTable = {
    title: `One year (${result.year}) · ${result.rows.toLocaleString("en-IN")} records`,
    columns: ["Step", "Time"],
    align: ["left", "right"],
    rows: [
      { cells: ["Read year from database", `${result.readMs} ms`] },
      { cells: ["Analytics over the year", `${result.analyticsMs} ms`] },
      { cells: ["Build report PDF", `${result.pdfMs} ms`] },
      { cells: ["Total", `${result.totalMs} ms`], strong: true },
    ],
  };
  return {
    title: "Load test results — one year",
    subtitle: `${result.rows.toLocaleString("en-IN")} records • run ${new Date(result.ranAt).toLocaleString("en-IN")}`,
    tables: [table],
    fileName: "load-test-results",
  };
}
