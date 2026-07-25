// Change detection used by the Daily Entry save guard. A save rewrites every
// customer's rows for a route+date, but a customer whose monthly bill is already
// Generated/Locked must not have their delivery change underneath the frozen
// bill. To tell a real correction from a value-identical rewrite, we reduce each
// customer's delivery to a signature and compare stored vs submitted.

// Canonical "this customer's delivery contributes nothing to the bill" — skipped,
// absent, or present with only zero quantities all collapse to this, so a rewrite
// between those states is correctly seen as "no bill change".
export const ABSENT_SIGNATURE = "ABSENT";

export type SignatureProduct = {
  productId: string;
  quantity: number;
  rateSnapshot: number;
};

// A customer's bill-affecting footprint for one date: the sorted set of delivered
// (qty > 0) products with their quantity and rate. Because the monthly bill is
// just sum(qty × rate), two states that yield the same amount yield the same
// signature — so blanket-rewriting a locked customer's rows to identical values
// reads as unchanged, while a real correction reads as changed.
export function deliverySignature(skipped: boolean, products: SignatureProduct[]): string {
  const delivered = skipped ? [] : products.filter((product) => product.quantity > 0);
  if (delivered.length === 0) {
    return ABSENT_SIGNATURE;
  }
  return delivered
    .map((product) => `${product.productId}:${product.quantity}:${product.rateSnapshot}`)
    .sort()
    .join("|");
}
