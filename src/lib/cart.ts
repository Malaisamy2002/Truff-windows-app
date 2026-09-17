import type { SnackSaleItem } from "./ops";

/**
 * Cart-line logic for the snack bill builder — kept separate from the
 * component so "how a repeat item behaves" is one small, testable place.
 */

/**
 * Adds a line to the cart. If the same item at the same unit price is
 * already in the cart, the quantities are merged into that one row instead
 * of adding a duplicate — so buying 2 now and 3 more a bit later shows up as
 * a single row with qty 5, not two rows.
 *
 * Rows are only merged when the unit price also matches: combo lines are
 * deliberately priced differently from a plain add, so two "same item, two
 * different prices" rows stay separate and each keeps its own correct total.
 */
export function addCartLine(
  cart: SnackSaleItem[],
  line: SnackSaleItem,
): SnackSaleItem[] {
  const idx = cart.findIndex(
    (row) =>
      row.item_name === line.item_name && row.unit_price === line.unit_price,
  );
  if (idx === -1) return [...cart, line];

  const next = [...cart];
  const existing = next[idx]!;
  const qty = existing.qty + line.qty;
  next[idx] = { ...existing, qty, amount: qty * existing.unit_price };
  return next;
}

/**
 * Updates a cart row's quantity in place and recalculates its amount.
 * Quantity 0 or below removes the row (same as tapping delete).
 */
export function setCartLineQty(
  cart: SnackSaleItem[],
  index: number,
  qty: number,
): SnackSaleItem[] {
  if (qty <= 0) return cart.filter((_, i) => i !== index);
  return cart.map((row, i) =>
    i === index ? { ...row, qty, amount: qty * row.unit_price } : row,
  );
}
