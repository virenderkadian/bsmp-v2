// How a product is named on screen.
//
// The rule is simply: never label a product by its `code`. A code is a sort
// key, not a name — in Rohtak, Buffalo Milk's code is "B" and its shortName is
// also "B", so a driver reading a cash sale back saw a column of bare letters.
// `code` stays a last-resort fallback for cash-sale entries recorded before
// the product name was stored on the device.

type Labelled = { name?: string | null; shortName?: string | null; code: string };

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// Full name. For anywhere with room for it — summary totals, cash sale
// entry and history — where the driver is reading figures back and needs to
// know exactly which product a number belongs to.
export function productLabel(product: Labelled): string {
  return clean(product.name) ?? clean(product.shortName) ?? product.code;
}

// The compact form, for tight rows like the delivery card's product line.
// Prefers shortName precisely because it's the operator's own abbreviation,
// but falls back to the full name rather than the code.
export function productShortLabel(product: Labelled): string {
  return clean(product.shortName) ?? clean(product.name) ?? product.code;
}
