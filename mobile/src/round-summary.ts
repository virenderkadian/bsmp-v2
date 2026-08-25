import type { DriverSheetCustomer } from "@shared/driver-api-types";
import type { CashSaleEntry } from "./cash-sale-types";
import { productLabel } from "./product-label";

// End-of-round figures, kept out of the screen so they can be tested.
//
// The rule that matters here is what counts as delivered. A customer the
// driver never reached still carries their prefilled usual order in
// `deliveredQty` — that is a suggestion for the delivery card, not a
// delivery — so only customers with a saved line are counted. Without that
// check the round read higher than what the web had actually recorded, by
// exactly the un-visited customers who happened to have a recent order.

export type RoundProductTotal = { productId: string; label: string; qty: number; unit: string };

export type RoundSummary = {
  delivered: number;
  skipped: number;
  // Stops with no saved line at all. Reported because the product totals
  // deliberately exclude them — without this the figures would just look
  // quietly low, with nothing on screen explaining why.
  notVisited: number;
  products: RoundProductTotal[];
};

export function summariseRound(customers: DriverSheetCustomer[]): RoundSummary {
  const totals = new Map<string, RoundProductTotal>();

  customers.forEach((customer) => {
    if (!customer.saved || customer.skipped) {
      return;
    }
    customer.products.forEach((product) => {
      const qty = Number(product.deliveredQty) || 0;
      if (qty <= 0) {
        return;
      }
      // Keyed by productId, never by label, so one product can't split into
      // two rows if its name is ever edited mid-round.
      const current =
        totals.get(product.productId) ??
        { productId: product.productId, label: productLabel(product), qty: 0, unit: product.unit };
      current.qty += qty;
      totals.set(product.productId, current);
    });
  });

  return {
    delivered: customers.filter((customer) => customer.saved && !customer.skipped).length,
    skipped: customers.filter((customer) => customer.saved && customer.skipped).length,
    notVisited: customers.filter((customer) => !customer.saved).length,
    products: [...totals.values()],
  };
}

// Cash sales stay SEPARATE from the delivered totals rather than folded in.
// They never reach the server and are on nobody's bill — merging them would
// make the round's delivery figures disagree with what actually gets billed.
export function summariseRoundCashSales(entries: CashSaleEntry[]): {
  totalAmount: number;
  products: RoundProductTotal[];
} {
  const totals = new Map<string, RoundProductTotal>();

  entries.forEach((entry) => {
    entry.items.forEach((item) => {
      const current =
        totals.get(item.productId) ??
        { productId: item.productId, label: productLabel(item), qty: 0, unit: item.unit };
      current.qty += item.quantity;
      totals.set(item.productId, current);
    });
  });

  return {
    totalAmount: entries.reduce((sum, entry) => sum + entry.totalAmount, 0),
    products: [...totals.values()],
  };
}
