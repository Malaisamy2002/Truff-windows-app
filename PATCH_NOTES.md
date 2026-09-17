# Windows parity patch

This archive contains the Windows build with two fixes ported from the newer
Android codebase:

- Narrow 50/58 mm receipt layouts now reserve the actual width needed for
  currency amounts, preventing long prices from losing digits.
- Snack sale creation and deletion now update the sale, stock quantity, stock
  timestamp, and stock-history audit row in one IndexedDB transaction. The
  in-memory stock query is updated immediately after success.

The existing Windows-specific premium receipt/UPI panel and Windows printer
path were kept intact.

Verification completed:

- `npx tsc --noEmit`
- `npm run build`
- `npm test` — 390 tests passed
- `npm run lint` — 0 errors; 14 pre-existing Fast Refresh warnings remain