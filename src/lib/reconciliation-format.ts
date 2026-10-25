// Display-only formatting for reconciliation figures. No rounding beyond
// what the values already carry (3dp for quantities, 2dp/paise for money) —
// this only trims zeros that say nothing, it never changes a number.

export function formatQty(value: string | number): string {
  const amount = typeof value === "string" ? Number(value) : value;
  return amount.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

export function formatMoney(value: string | number): string {
  const amount = typeof value === "string" ? Number(value) : value;
  // Paise only show up when there are any — ₹850, not ₹850.00, but ₹67.50
  // keeps its half-rupee rather than collapsing to ₹67.5.
  const hasPaise = Math.round(amount * 100) % 100 !== 0;
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}
