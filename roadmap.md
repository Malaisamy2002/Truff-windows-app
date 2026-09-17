# Consolidation roadmap (8 exports → one build)

## Done
- Collapsible list blocks (`ListDisclosure`) now wrap every long record list: all bills, open tabs (Dues), snack bills, stock items, saved customers, expenses and recurring expenses, turf bookings and pending dues. Closed by default, count shown in the header, choice remembered per list; checked at phone (390px) and desktop widths.
- Settings card alignment pass completed: printer settings grouped into shared field shapes; Billing & GST and Invoice branding rows aligned; Telegram backup now uses the same fields, switch rows, and responsive action layout; unused branding switch import removed; phone and desktop preview checked.
- Base = Source_code_audit_fixed_tax; due-numbers / greyed moved bills / 80 mm receipt wrap (billing-buddy)
- Frozen tax everywhere in analytics (bills, bookings, snacks); tab cash payments count as collected
- One canonical due (bookingDue/billDue) in Dashboard, Reports, Today card, WhatsApp summary, exports, mark-paid
- Tab ledger date = local day; payment_mode stored on tab payments
- Date bugs: previous-day spill-over, midnight utilisation split, calendar header
- Phone-first customer identity (lifetime stats, directory, "who still owes" incl. tab)
- Five day-parts in five columns; multi-court slot availability + "Courts available" setting
- Slot-duration toggles (already in base)

- Payment-mode picker (Cash/UPI) on the Dues tab collect box, "Settle all", and the customer tab card — saved on the payment and shown in the ledger
- Remaining UTC date slices fixed: Excel export filenames (xlsx.ts), layout-preset exports (ArrangeToolbar.tsx), the print-test receipt date (PrintSettingsCard.tsx), and recurring expenses (expenses.ts) — the last of these now stores a plain local date, posts on the IST day, and clamps "the 31st" to month-end
- Settings tab reordered to the usage-priority order in `.lovable/plan/optimize-the-settings-tab-order-2026-09-05.md` (Data Safety first, advanced/diagnostics last), with a one-time migration for existing saved layouts — covered by `layout-prefs.test.ts`
- Resolved-CSS theme cache verified with a new `theme.test.ts`: light/dark toggling replays cached values byte-for-byte instead of redriving the color math
- Regression tests added: `expenses.test.ts` (recurring-posting date rules), IST bucketing cases appended to `analytics.test.ts`, `theme.test.ts` (cache round-trip)
- Docs refreshed: `docs/calculation-rules.md` now lists the newly-fixed UTC call sites; `docs/README-theme-picker.md` rewritten to match the current oklch/dual-mode/cache implementation (was describing an older HSL, light-only version)

- Dues double-count audit: `bookingCashCollected()` is now the only "cash taken" figure for a booking (totals, payment-mode split, Turf tab, Reports dues list, Reports Excel "Advance paid", customer popup); "Mark paid" deliberately keeps the stored figure. Bookings/snack sales whose balance sits on dues are faded and tagged "Moved to dues · D-…". Covered by new cases in `dues.test.ts` and `analytics.test.ts`, section 12 of `scripts/verify-math.ts`, and written up in `docs/formula-report.md` §9 / `docs/calculation-rules.md` §2b.

- Telegram cloud backup wired into Settings as the first Data Safety card (`settings.telegram`, order version 5); GitHub push/pull moved into a collapsed "Advanced" block inside Backup & restore, and the receipts .zip export/import into a collapsed "Advanced" inside Receipts sharing ("Verify receipts" stays in the main view); setup steps added to the README and as a "How do I set this up?" panel in the card
- GitHub backup/restore removed entirely (superseding the line above): `github.ts`/`github.test.ts` deleted, the "GitHub backup" card and its now-empty "Advanced" collapsible removed from `BackupCard.tsx`, and year-archiving (`archiveYear()` in `archive.ts`) no longer pushes to GitHub or requires it to be configured — it downloads the year's file locally and deletes the rows, same as before minus the cloud step

## Open
- No specific "theme card redesign" brief was found anywhere in the repo (no `.lovable/plan` doc, no other notes) — only the resolved-CSS cache half of that roadmap line had a concrete, testable ask, which is now done. If a visual redesign of `ThemeCustomizerCard.tsx` was intended, it needs its own spec.
