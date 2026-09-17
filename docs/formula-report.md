# Line-by-line formula report

Audit of every money formula in the app after money math was centralized on
`src/lib/money.ts`. `R(x)` below means `rupees(x)` — whole rupee, half away
from zero. Every figure the app shows, prints or exports is `R(...)`.

Verified by: `bunx vitest run` (246 tests across 14 files — `money`, `dues`,
`merge`, `tabs`, `analytics`, `expenses`, `print`, `receipt`, …) and
`bun scripts/verify-math.ts` (independent hand-computed audit, sections 1-12,
all checks pass).

---

## 1. Rounding primitives — `src/lib/money.ts`

| Function | Formula |
|---|---|
| `rupees(n)` | `n < 0 ? -round(-n) : round(n)` |
| `money(n)` | `(n < 0 ? "-₹" : "₹") + \|R(n)\|` with `en-IN` grouping |
| `splitHalf(t)` | `a = R(R(t)/2)`, `b = R(t) - a` → `a + b = R(t)` exactly |
| `sumRupees(xs)` | `Σ R(x)` — each amount rounded once, then summed |

## 2. Bill line and bill totals — `src/lib/biz.ts`

```
rowTotal(r)        = R(rate × qty)
subtotal           = Σ rowTotal(row)                      (screen-side)
discount           = R(discount entered)
bill.total         = R(subtotal - discount)               STORED post-discount
billGrossTotal(b)  = R(b.total) + taxBreakdown(R(b.total)).taxAmount
billPaidAmount(b)  = status === "paid" ? billGrossTotal(b) : b.amount_paid
balanceOf(b)       = status === "paid" ? 0
                     : max(0, billGrossTotal(b) - R(b.amount_paid))
```

## 3. Taxes — `src/lib/settings.ts`

```
taxable            = R(bill.total)                         (already post-discount)
line_i             = R(taxable × rate_i / 100)             one per active tax
GST split          = splitHalf(line_gst) → CGST, SGST      CGST + SGST = line_gst
taxAmount          = Σ line_i                              = Σ printed lines
grandTotal         = taxable + taxAmount
```

Invariant: the printed lines on a receipt always add up to its Grand Total
(`money.test.ts`: "returns whole-rupee lines that add up to taxAmount").

## 4. Dues — `src/lib/dues.ts`

```
netTabAmountFor(refType, refId) = max(0, R(Σ charges - Σ payments for that ref))
bookingDue(b)      = financial(b) ? max(0, R(total_amount - advance_paid - onTab)) : 0
billDue(bill)      = onTabBill ? 0 : max(0, R(balanceOf(bill) - onTab))
snackSaleDue()     = 0                                    (paid at counter or on tab)
billCollected(b)   = onTabBill ? max(0, R(amount_paid))
                     : status === "paid" ? R(billGrossTotal(b)) : R(amount_paid)
snackSaleCollected = onTab ? 0 : R(sale.total)
customerOutstanding.total = max(0, tabBalance) + Σ bookingDue + Σ billDue
```

A rupee of due lives in exactly one place: booking balance, bill balance, or
the tab ledger. `onTab` subtraction is what keeps it from living in two.

## 5. Customer tab — `src/lib/tabs.ts`

```
entry.amount       = R(input.amount)          rejected when ≤ 0
tabBalanceOf(es)   = R(Σ (charge ? R(a) : -R(a)))
settle & close     = writes one payment for the current balance → balance 0
over-collection    = negative balance = credit; dues screens clamp at max(0, …)
reopen             = status flip only; the balance stays derived from entries
```

## 6. Merge / un-merge — `src/lib/merge.ts`

```
collected     = R(min(total, Σ source collected))
alreadyOnTab  = R(Σ netTabAmountFor(source))
outstanding   = R(max(0, total - collected))
tabDelta      = R(outstanding - alreadyOnTab)

merge   → one payment per source (ref merge_reverse, source_ref = the record)
          + one charge for `outstanding` when "On tab" is ticked
unmerge → deletes the merge_reverse rows (restoring each source charge
          exactly) and reverses the merged bill's own charge
```

Invariants tested (`merge.test.ts`): `collected + outstanding = total`;
over-collection never yields negative outstanding; a merged source nets to
zero on the customer's balance while keeping its gross source charge; a
second un-merge is a no-op.

## 7. Period aggregates — `src/lib/analytics.ts`

```
per bill: net = R(bill.total); tax = taxBreakdown(net).taxAmount; gross = net + tax
          paid = onTabBill ? max(0, R(amount_paid))
                 : status === "paid" ? gross : R(amount_paid)
          owned = onTabBill ? gross - paid : netTabAmountFor(bill)
          billsDues += max(0, gross - paid - owned)      ← ledger money excluded

billsRevenue  = Σ net
tax           = Σ per-bill tax
turfRevenue   = Σ R(total_amount)                (unmerged, non-cancelled)
snacksRevenue = Σ R(sale.total)                  (unmerged sales)
netRevenue    = billsRevenue + turfRevenue + snacksRevenue
revenue       = netRevenue + tax
collected     = Σ billsCollected + Σ bookingCashCollected + Σ snackSaleCollected
                + tabCollected                   ← NOT Σ R(advance_paid); see §9
expenses      = Σ R(expense.amount)
profit        = netRevenue - expenses            ← never revenue - expenses
dues          = billsDues + Σ bookingDue
snackProfit   = Σ R(sale.profit)
paymentSplit  = Σ R(received) by mode, "On tab" excluded entirely
taxReport     = taxable = billsRevenue; lines = taxBreakdown(billsRevenue).lines
```

Invariants tested (`analytics.test.ts`): `revenue = netRevenue + tax`;
profit unchanged when GST is switched on; tax applies to the post-discount
total; "On tab" never counted as collected; ledger-owned money never
double-counted as a due; cancelled and merged records excluded everywhere.

## 8. Output surfaces — same figures as the screens

| Surface | Formatter | Result |
|---|---|---|
| App screens | `money()` | ₹, whole rupees |
| Receipts / bill PDFs (`receipt.ts`) | `pmoney()` = `rupees()` + "Rs " | whole rupees |
| Report PDF (`report-pdf.ts`) | `pmoney()` = `rupees()` + symbol | whole rupees |
| WhatsApp summary / bill text | `money()` | whole rupees |
| Dashboard Excel (`dashboard-xlsx.ts`) | `rupees()` + `en-IN` | whole rupees |
| Excel money columns (`xlsx.ts`) | numFmt `#,##0` | whole rupees |

No other money formatter exists in the codebase (`toFixed` / manual
`toLocaleString` remain only for percentages, colour math and record counts).

## 9. Balance moved to dues — the same rupee, exactly once

"Put balance on tab" settles a turf booking by writing
`advance_paid = bookingGrossTotal(b)` while posting the remainder as a tab
charge against that booking. Reading `advance_paid` as cash would count that
rupee twice: once on the booking, and again as a tab payment when the customer
settles on the Dues tab. A snack sale billed "On tab" has the same shape.

```
netTabAmountFor(entries, ref_type, ref_id)
                     = max(0, Σ charge − Σ payment) for that source record
bookingCashCollected(b, entries)
                     = max(0, R(b.advance_paid) − netTabAmountFor(…, b.id))
bookingDue(b, e)     = max(0, bookingGrossTotal(b) − R(advance_paid) − onTab)
bookingMovedToDues   = no merge AND netTabAmountFor(…) > 0
saleMovedToDues      = no merge AND (payment_mode = "On tab" OR netTab > 0)
isTabCashPayment(e)  = kind = "payment" AND no ref_type
                       (a payment WITH a ref_type is a merge/un-merge
                        reversal — bookkeeping only, no cash moved)
tabCollected         = Σ R(e.amount) for isTabCashPayment entries in period
```

Every "collected / received / paid" figure for a booking routes through
`bookingCashCollected`: `periodStats.collected`, `paymentSplit`, the Turf tab
row, the Reports turf-dues list, the Reports Excel "Advance paid" column, and
the customer popup's booking rows.

One deliberate exception: the Reports "Mark paid" button writes
`advance_paid = stored paid + due` back to the record, so it keeps using the
STORED figure — using cash-taken there would wipe out the balance already
parked on the tab.

Screens also label the state: a booking or snack sale whose money sits on the
tab is faded and tagged "Moved to dues · D-…" (due number from
`dueNoForRef`), showing the real cash taken, the amount now on dues, and a
note pointing at the Dues tab.

Worked example (verify-math §12, October): ₹1000 booking, ₹400 taken at the
counter, ₹600 moved to dues, plus a ₹300 "On tab" snack sale.

| Stage | collected | payment split |
|---|---|---|
| Dues open | ₹400 | Cash ₹400 |
| ₹900 settled on Dues tab by UPI | ₹1300 | Cash ₹400 + UPI ₹900 |

Never ₹1900. Regression cover: `dues.test.ts` (`bookingCashCollected`,
`bookingMovedToDues` / `saleMovedToDues`), `analytics.test.ts`
("no double counting when a balance moves to dues"), and
`scripts/verify-math.ts` §12.
