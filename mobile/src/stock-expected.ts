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
