# Verification dataset — expected results

**Verified:** every number below was checked by running the actual
`periodStats`/`customerLifetimeStats`/`taxBreakdown` logic (transcribed
line-for-line from `analytics.ts`/`data.ts`/`settings.ts`) against this
exact seed data in Node, not just computed by hand.

**Timezone bug found and fixed.** The first version of this check
surfaced a real bug in `analytics.ts`, not just the test setup:
`monthKey()`/`dayKey()` bucketed a full ISO timestamp (`bill_date`) using
`x.getFullYear()`/`getMonth()`/`getDate()` — the JS runtime's *local*
timezone, not IST specifically, even though the surrounding comment said
"IST." It only produced correct results because the app happens to run
on devices already set to IST; the boundary bill in this dataset (B4,
`2026-06-30T19:00:00.000Z` = `2026-07-01 00:30 IST`) landed in the wrong
month the moment the same code ran anywhere else (this script's
container defaults to UTC). `monthKey()`/`dayKey()` now anchor to IST
explicitly via a fixed +5:30 offset applied to the UTC instant, instead
of relying on the runtime's clock settings — `prevMonthKey()`/
`lastMonthKeys()` were tightened the same way. Confirmed by re-running
this exact script under UTC, US/Pacific, and Asia/Kolkata: all three now
produce identical output, matching every figure in this doc.

Companion to `src/lib/verificationSeed.ts`. Load the data (Settings → year
archive card → "Load verification data (2 months)"), make sure GST / custom
taxes are **off** (the default — see the note at the bottom if you want to
check the tax-on path too), then open Dashboard/Reports for **June 2026**
and **July 2026** and check every number below against what's on screen.
Row-level source data is at the bottom so you can trace any mismatch back
to a specific bill/booking/sale.

If a number doesn't match, it points at a real bug: every figure here was
computed straight from `docs/calculation-rules.md`'s formulas, not from the
app itself.

---

## June 2026 — periodStats

| Field | Expected |
|---|---|
| billsRevenue | ₹6,500 |
| billsTax | ₹0 |
| billsCollected | ₹4,700 |
| billsDues | ₹1,800 |
| turfRevenue | ₹2,200 |
| snacksRevenue | ₹230 |
| netRevenue | ₹8,930 |
| revenue (gross) | ₹8,930 |
| tax | ₹0 |
| collected | ₹6,530 |
| expenses | ₹800 |
| profit | ₹8,130 |
| dues | ₹2,400 |
| snackProfit | ₹90 |
| avgBookingValue | ₹1,100 (₹2,200 / 2 unmerged, non-cancelled bookings) |

**What's in June, and why:**
- Bills: B1 (Arun, ₹2,000, paid), B2 (Divya, ₹3,000, ₹1,200 paid → ₹1,800
  due), B3 (Bala, ₹1,500, paid — this is the merge target for BK2).
- Bookings counted toward turfRevenue: BK1 (Arun, ₹1,200, fully paid) and
  BK4 (Arun, ₹1,000, ₹400 paid → ₹600 due). **Not** counted: BK2 (merged
  into B3 — its ₹1,500 lives on the bill, not here) and BK3 (Cancelled).
- Snacks: S1 (₹150) + S2 (₹80) = ₹230.
- Expenses: E1 (₹500) + E2 (₹300) = ₹800.

**Sanity checks this exercises:**
- If turfRevenue shows ₹3,700 instead of ₹2,200, the merge exclusion
  (`isFinancialBooking`) isn't being applied somewhere — BK2's ₹1,500 is
  being counted twice (once on B3, once on BK2 itself).
- If turfRevenue shows ₹3,200, BK3's cancelled ₹1,000 leaked in.

---

## July 2026 — periodStats

| Field | Expected |
|---|---|
| billsRevenue | ₹4,000 |
| billsTax | ₹0 |
| billsCollected | ₹1,800 |
| billsDues | ₹2,200 |
| turfRevenue | ₹4,100 |
| snacksRevenue | ₹180 |
| netRevenue | ₹8,280 |
| revenue (gross) | ₹8,280 |
| tax | ₹0 |
| collected | ₹5,480 |
| expenses | ₹950 |
| profit | ₹7,330 |
| dues | ₹2,800 |
| snackProfit | ₹65 |
| avgBookingValue | ₹2,050 (₹4,100 / 2 unmerged, non-cancelled bookings) |

**What's in July, and why:**
- Bills: **B4 (Ganesh, ₹1,800, paid)** and B5 (Chitra, ₹2,200, unpaid →
  ₹2,200 due).
- Bookings: BK5 (Divya, ₹2,500, fully paid) and BK6 (Ganesh, ₹1,600, ₹1,000
  paid → ₹600 due). BK7 (Arun, Cancelled) contributes nothing.
- Snacks: S3 (₹120) + S4 (₹60) = ₹180.
- Expenses: E3 (₹700) + E4 (₹250) = ₹950.

**The month-boundary trap (B4):** its `bill_date` is stored as
`2026-06-30T19:00:00.000Z` — a UTC timestamp. Sliced naively (first 7
chars) that reads `"2026-06"`, i.e. June. But 19:00 UTC on June 30 is
**00:30 IST on July 1** — the correct calendar day. `monthKey()` /
`dayKey()` now bucket this correctly by construction — an explicit +5:30
IST offset is applied to the UTC instant before reading the calendar
date back out, so the result is the same regardless of what timezone the
device running the app happens to be set to.

- B4's ₹1,800 appears in **July's** billsRevenue/billsCollected (as shown
  above) and **not** June's — check this on screen after loading the
  data. Confirmed identical under UTC, US/Pacific, and IST when this was
  tested directly against the algorithm (see the note at the top of this
  doc).
- Dashboard's "first/last activity" for Ganesh P should read **Jul 1**,
  not Jun 30 — same underlying date, just rendered via `Date()` rather
  than a string slice.

---

## Customer lifetime rollups (`customerLifetimeStats`)

These are **lifetime** (June + July combined) — customer view isn't
month-scoped. `firstActivity`/`lastActivity` are the raw stored strings,
compared lexically (not parsed as dates) — for a booking/sale that's a
plain `YYYY-MM-DD`, but for a bill it's the full ISO timestamp. Below,
dates are simplified to just the calendar day where the winning record is
a booking/sale; where a bill's full timestamp wins the comparison, the
raw value is shown in full (Chitra's lastActivity, Divya's firstActivity,
Ganesh's firstActivity) — confirmed by the verification script.

### Arun Kumar (phone 9000000001)
| Field | Expected |
|---|---|
| billsSpend | ₹2,000 |
| turfSpend | ₹2,200 (BK1 + BK4; BK7 cancelled excluded) |
| snacksSpend | ₹150 |
| totalSpend | ₹4,350 |
| bookingsCount | 3 (BK1, BK4, BK7 — cancelled still counts as a visit) |
| avgBookingValue | ₹1,033.33 ((1,200+1,000+900) / 3 — includes the cancelled ₹900) |
| outstandingTurfDues | ₹600 (BK4 only; BK7 excluded as cancelled) |
| firstActivity | 2026-06-05 |
| lastActivity | 2026-07-20 |

### Bala S (phone 9000000002)
| Field | Expected |
|---|---|
| billsSpend | ₹1,500 |
| turfSpend | ₹0 (BK2 is merged → excluded) |
| snacksSpend | ₹80 |
| totalSpend | ₹1,580 |
| bookingsCount | 1 (BK2 — merged bookings still count as a visit) |
| avgBookingValue | ₹1,500 (BK2's gross amount, even though merged) |
| outstandingTurfDues | ₹0 |
| firstActivity | 2026-06-15 |
| lastActivity | 2026-06-16 |

**This is the customer-level double-count trap:** if turfSpend shows
₹1,500 instead of ₹0, BK2 isn't being excluded despite being merged into
B3 — Bala's money would be double-counted (once via billsSpend, once via
turfSpend) and totalSpend would be inflated by ₹1,500.

### Chitra R (no phone — matched by name only)
| Field | Expected |
|---|---|
| billsSpend | ₹2,200 |
| turfSpend | ₹0 (BK3 cancelled → excluded) |
| snacksSpend | ₹0 |
| totalSpend | ₹2,200 |
| bookingsCount | 1 (BK3 — cancelled still counts as a visit) |
| avgBookingValue | ₹1,000 (BK3's gross amount, even though cancelled) |
| outstandingTurfDues | ₹0 |
| firstActivity | 2026-06-20 |
| lastActivity | `2026-07-22T08:00:00.000Z` (B5's full bill timestamp — renders as Jul 22 local) |

**This exercises name-only identity matching** (no phone on this
customer) — if Chitra's totals come back empty, the phone-first/name-
fallback matching in `customerKey`/`normName` broke for phoneless
customers.

### Divya M (phone 9000000004)
| Field | Expected |
|---|---|
| billsSpend | ₹3,000 |
| turfSpend | ₹2,500 |
| snacksSpend | ₹120 |
| totalSpend | ₹5,620 |
| bookingsCount | 1 |
| avgBookingValue | ₹2,500 |
| outstandingTurfDues | ₹0 |
| firstActivity | `2026-06-10T09:00:00.000Z` (B2's full bill timestamp — renders as Jun 10 local) |
| lastActivity | 2026-07-08 |

### Ganesh P (phone 9000000005)
| Field | Expected |
|---|---|
| billsSpend | ₹1,800 |
| turfSpend | ₹1,600 |
| snacksSpend | ₹60 |
| totalSpend | ₹3,460 |
| bookingsCount | 1 |
| avgBookingValue | ₹1,600 |
| outstandingTurfDues | ₹600 |
| firstActivity | displayed as **Jul 1, 2026** (stored string is `2026-06-30T19:00:00.000Z` — see the month-boundary note above; any date display must parse this with `Date()`/local getters, never a raw string slice) |
| lastActivity | 2026-07-15 |

---

## Row-level source data

| Doc | Customer | Date (as stored) | Amount | Paid/Advance | Status | Notes |
|---|---|---|---|---|---|---|
| B1 (bill) | Arun Kumar | 2026-06-05T10:00Z | ₹2,000 | ₹2,000 | paid | — |
| B2 (bill) | Divya M | 2026-06-10T09:00Z | ₹3,000 | ₹1,200 | partial | ₹1,800 due |
| B3 (bill) | Bala S | 2026-06-15T12:00Z | ₹1,500 | ₹1,500 | paid | merge target for BK2 |
| B4 (bill) | Ganesh P | 2026-06-30T19:00Z (= Jul 1, 00:30 IST) | ₹1,800 | ₹1,800 | paid | month-boundary case |
| B5 (bill) | Chitra R | 2026-07-22T08:00Z | ₹2,200 | ₹0 | unpaid | ₹2,200 due |
| BK1 (booking) | Arun Kumar | 2026-06-05 | ₹1,200 | ₹1,200 | Completed | standalone |
| BK2 (booking) | Bala S | 2026-06-15 | ₹1,500 | ₹1,500 | Completed | merged → B3 |
| BK3 (booking) | Chitra R | 2026-06-20 | ₹1,000 | ₹0 | Cancelled | — |
| BK4 (booking) | Arun Kumar | 2026-06-25 | ₹1,000 | ₹400 | Completed | ₹600 due |
| BK5 (booking) | Divya M | 2026-07-08 | ₹2,500 | ₹2,500 | Completed | standalone |
| BK6 (booking) | Ganesh P | 2026-07-14 | ₹1,600 | ₹1,000 | Completed | ₹600 due |
| BK7 (booking) | Arun Kumar | 2026-07-20 | ₹900 | ₹0 | Cancelled | — |
| S1 (sale) | Arun Kumar | 2026-06-05 | ₹150 | profit ₹60 | — | linked to BK1 |
| S2 (sale) | Bala S | 2026-06-16 | ₹80 | profit ₹30 | — | standalone |
| S3 (sale) | Divya M | 2026-07-08 | ₹120 | profit ₹45 | — | linked to BK5 |
| S4 (sale) | Ganesh P | 2026-07-15 | ₹60 | profit ₹20 | — | standalone |
| E1 (expense) | — | 2026-06-12 | ₹500 | — | — | Maintenance |
| E2 (expense) | — | 2026-06-28 | ₹300 | — | — | Utilities |
| E3 (expense) | — | 2026-07-05 | ₹700 | — | — | Salaries |
| E4 (expense) | — | 2026-07-25 | ₹250 | — | — | Maintenance, business=Snacks |

---

## If you want to check the tax-ON path too

None of the above assumes GST/custom taxes are on. To check tax
separately: turn on GST at, say, 18% in Settings, then only the **Bills**
figures change (turf/snack revenue never carries tax):

```
billsTax (June)  = 18% × 6,500 = ₹1,170
revenue (June)   = netRevenue + billsTax = 8,930 + 1,170 = ₹10,100
profit (June)    = unchanged at ₹8,130 (profit uses netRevenue, not revenue)
```

`billsCollected`/`billsDues` also shift because `gross = net + tax` changes
what "fully paid" means for bills marked `status: "paid"` (their `paid`
becomes the new, higher `gross`, not the stored `amount_paid`). Recompute
per bill using `docs/calculation-rules.md` §4 if you want exact numbers —
the point of this check is just confirming `profit` doesn't move and
`revenue` does.
