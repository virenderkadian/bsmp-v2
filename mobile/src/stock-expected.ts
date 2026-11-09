import type { DriverStockProduct } from "@shared/driver-api-types";

// Mirror of expectedStock/expectedStockTotal in ../src/lib/driver-stock-rules.ts
// (which holds the unit tests). Duplicated on purpose: Metro only resolves
// type-only imports from outside mobile/, so runtime code can't be shared.
// Keep the two in step.
type Row = Pick<DriverStockProduct, "given" | "returned" | "eveningSold" | "morningSold" | "rate">;

export function expectedStock(product: Row) {
  const qty = Math.round((Number(product.given) - Number(product.eveningSold) - Number(product.morningSold) - Number(product.returned)) * 1000) / 1000;
  return { qty, amount: Math.round(qty * Number(product.rate) * 100) / 100 };
}

export function expectedStockTotal(products: Row[]) {
  return Math.round(products.reduce((sum, product) => sum + expectedStock(product).amount, 0) * 100) / 100;
}

// Everything the dashboard tile and the details screen show, in one place so
// the two can never disagree. `net` is what is still to be handed in: expected
// value minus deposits the office has already verified for the cycle.
export function expectedCashSummary(stock: { products: Array<Row & { id: string; name: string; unit: string }>; depositedVerified: string; complete: boolean }) {
  // Highest amount first; the stable sort keeps the configured product order
  // for ties.
  const rows = stock.products.map((product) => ({ product, ...expectedStock(product) })).sort((a, b) => b.amount - a.amount);
  // Products with exactly nothing to account for are hidden. The totals below
  // still use every product, so hiding a zero row can never change the total.
  const visibleRows = rows.filter((row) => row.amount !== 0);
  const gross = expectedStockTotal(stock.products);
  const deposited = Number(stock.depositedVerified) || 0;
  const net = Math.round((gross - deposited) * 100) / 100;
  return { rows: visibleRows, gross, deposited, net, hasShortage: visibleRows.some((row) => row.qty < 0), finalised: stock.complete };
}
