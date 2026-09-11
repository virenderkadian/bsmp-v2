// Which products a sheet or a bill should actually have a column for.
//
// Every product view used to take the whole active catalogue filtered by
// `showInDailyEntry`, which meant a milk-only round printed a column for all
// eleven products in the city — and, worse, a product NOT flagged for daily
// entry was billed for the right amount while getting no column at all, so the
// lines on the page didn't add up to the total.
//
// The rule here is the honest one: a column exists because something was sold
// into it. That fixes the eleven-columns-on-A4 problem and is what makes an
// occasional item (a one-off kilo of ghee) printable on the one bill it
// belongs to without appearing on everybody else's.

export type ProductColumn = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  unit: string;
};

// A product carrying the flag that decides how it is presented. `true` means
// it earns a day-by-day column; `false` means it is an occasional sale that
// belongs in a single "other items" line instead.
export type ClassifiedProduct = ProductColumn & { showInDailyEntry: boolean };

export type QuantityRow = {
  productQuantities: Record<string, string>;
};

// Zero is not "sold". A customer whose row carries an explicit 0 for a product
// — the deliberate-correction case Daily Entry keeps — should not resurrect a
// column for the whole route.
export function soldProductIds(rows: QuantityRow[]): Set<string> {
  const used = new Set<string>();

  for (const row of rows) {
    for (const [productId, quantity] of Object.entries(row.productQuantities)) {
      if (Number(quantity) !== 0) {
        used.add(productId);
      }
    }
  }

  return used;
}

function pick(quantities: Record<string, string>, keep: Set<string>): Record<string, string> {
  return Object.fromEntries(Object.entries(quantities).filter(([productId]) => keep.has(productId)));
}

type SummaryTotals = {
  productQuantities: Record<string, string>;
  deliveryAmount: string;
  openingBalance: string;
  paymentAmount: string;
  pendingAmount: string;
};

type SummaryRow = QuantityRow & {
  deliveryAmount: string;
  openingBalance: string;
  paymentAmount: string;
  pendingAmount: string;
};

function totalRows<Row extends SummaryRow>(rows: Row[], products: ProductColumn[]): SummaryTotals {
  const productQuantities = Object.fromEntries(
    products.map((product) => [
      product.id,
      rows
        .reduce((total, row) => total + Number(row.productQuantities[product.id] ?? 0), 0)
        .toFixed(3),
    ]),
  );

  const sum = (get: (row: Row) => string) =>
    rows.reduce((total, row) => total + Number(get(row)), 0).toFixed(2);

  return {
    productQuantities,
    deliveryAmount: sum((row) => row.deliveryAmount),
    openingBalance: sum((row) => row.openingBalance),
    paymentAmount: sum((row) => row.paymentAmount),
    pendingAmount: sum((row) => row.pendingAmount),
  };
}

// Narrows a whole summary payload to the products its rows actually sold, and
// recomputes the totals so the columns and the totals row agree.
//
// Applied to the assembled payload rather than pushed back into the queries:
// the rows are the only place that knows what survived every filter and
// fallback above, so deriving the columns from them cannot drift.
export function narrowSummaryToSoldProducts<
  Row extends SummaryRow,
  Route extends { rows: Row[]; totals: SummaryTotals },
  Payload extends { products: ClassifiedProduct[]; routes: Route[]; grandTotals: SummaryTotals },
>(payload: Payload, showOccasionalColumns = false): Payload {
  const allRows = payload.routes.flatMap((route) => route.rows);
  const sold = soldProductIds(allRows);
  // Occasional sales are money on this sheet, never a column — their amounts
  // are already inside every Amount and total, they simply do not earn a
  // column of their own. The customer's bill is where they are itemised.
  // Configuration can turn the columns back on.
  const keep = showOccasionalColumns
    ? sold
    : new Set(
        [...sold].filter(
          (productId) =>
            payload.products.find((product) => product.id === productId)?.showInDailyEntry !== false,
        ),
      );

  // Nothing sold at all — an empty month, or a route whose deliveries haven't
  // been entered yet. Keep the catalogue so the sheet still has its shape
  // rather than collapsing to a column-less table. A month of nothing BUT
  // occasional sales is a real case though, and correctly shows no columns.
  if (sold.size === 0) {
    return payload;
  }

  const products = payload.products.filter((product) => keep.has(product.id));
  const routes = payload.routes.map((route) => {
    const rows = route.rows.map((row) => ({ ...row, productQuantities: pick(row.productQuantities, keep) }));
    return { ...route, rows, totals: totalRows(rows, products) };
  });

  return {
    ...payload,
    products,
    routes,
    grandTotals: totalRows(
      routes.flatMap((route) => route.rows),
      products,
    ),
  };
}

// Everyday products get a calendar column; everything else is an occasional
// sale.
//
// A month of paneer is two numbers. Giving it a column means 29 empty cells to
// carry them, on a page that is already tight on A4 — so occasional items are
// summarised on one line beneath the calendar and added into the same total.
// `showInDailyEntry` already draws exactly this line: it is the flag that says
// whether a product is on the grid the round is entered on every morning.
export function splitDailyAndOccasional<T extends ClassifiedProduct>(
  products: T[],
): { daily: T[]; occasional: T[] } {
  return {
    daily: products.filter((product) => product.showInDailyEntry),
    occasional: products.filter((product) => !product.showInDailyEntry),
  };
}

export type BilledItem = {
  productId: string;
  totalQty: string;
  averageRate: string;
  totalAmount: string;
};

export type OtherItemLine = {
  productId: string;
  name: string;
  shortName: string | null;
  unit: string;
  quantity: string;
  rate: string;
  amount: string;
};

// The "other items" line beneath a bill's calendar.
//
// Read off the bill's own stored items, which already hold the month's
// quantity, the average rate actually charged (not the catalogue rate) and the
// amount — so a rate typed by hand at the door prints as it was charged.
export function otherItemsFor(
  occasional: ClassifiedProduct[],
  items: BilledItem[],
): { lines: OtherItemLine[]; total: string } {
  const byId = new Map(occasional.map((product) => [product.id, product]));
  const lines: OtherItemLine[] = [];
  let total = 0;

  for (const item of items) {
    const product = byId.get(item.productId);

    // Zero-quantity items exist as corrections and are not a sale to print.
    if (!product || Number(item.totalQty) === 0) {
      continue;
    }

    total += Number(item.totalAmount);
    lines.push({
      productId: product.id,
      name: product.name,
      shortName: product.shortName,
      unit: product.unit,
      quantity: Number(item.totalQty).toFixed(3),
      rate: Number(item.averageRate).toFixed(2),
      amount: Number(item.totalAmount).toFixed(2),
    });
  }

  return { lines, total: total.toFixed(2) };
}
