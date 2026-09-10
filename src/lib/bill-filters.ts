// The one definition of "which bill rows are showing".
//
// The screen and the two print routes are separate renders — the screen filters
// in the browser, the print pages are their own server routes reached by URL. A
// filter that lives only in the client is silently dropped on the way to paper,
// which is how a filtered screen came to print an unfiltered sheet. Keeping the
// rules here, and the URL round-trip below, is what stops the two drifting
// apart again.

export type BillAmountField = "closingBalance" | "deliveryAmount";

export type BillFilters = {
  status: string;
  search: string;
  amountField: BillAmountField;
  minAmount: string;
  maxAmount: string;
};

export const emptyBillFilters: BillFilters = {
  status: "",
  search: "",
  amountField: "closingBalance",
  minAmount: "",
  maxAmount: "",
};

// What a row needs to expose to be filtered. Both tabs' row shapes satisfy it:
// the Summary calls the closing balance `pendingAmount`, so the caller maps it.
export type FilterableBillRow = {
  customerCode: string;
  customerName: string;
  customerArea?: string | null;
  status: string | null;
  pendingAmount: string;
  deliveryAmount: string;
};

export function withinAmountRange(value: number, minAmount: string, maxAmount: string) {
  const min = minAmount.trim() === "" ? null : Number(minAmount);
  const max = maxAmount.trim() === "" ? null : Number(maxAmount);

  return (
    (min === null || Number.isNaN(min) || value >= min) &&
    (max === null || Number.isNaN(max) || value <= max)
  );
}

export function matchesBillFilters(row: FilterableBillRow, filters: BillFilters): boolean {
  // A customer with no bill yet has a null status, so filtering by status
  // correctly excludes them rather than lumping them in with Draft.
  if (filters.status !== "" && row.status !== filters.status) {
    return false;
  }

  const query = filters.search.trim().toLowerCase();

  if (
    query !== "" &&
    !row.customerCode.toLowerCase().includes(query) &&
    !row.customerName.toLowerCase().includes(query) &&
    !(row.customerArea?.toLowerCase().includes(query) ?? false)
  ) {
    return false;
  }

  const amount = Number(
    filters.amountField === "closingBalance" ? row.pendingAmount : row.deliveryAmount,
  );

  return withinAmountRange(amount, filters.minAmount, filters.maxAmount);
}

// Only the filters actually set are written, so an unfiltered print keeps the
// short, shareable URL it has always had.
export function billFiltersToParams(filters: BillFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.search.trim()) {
    params.set("search", filters.search.trim());
  }
  if (filters.minAmount.trim() || filters.maxAmount.trim()) {
    // The field only means something alongside a bound, so it rides with them.
    params.set("amountField", filters.amountField);
  }
  if (filters.minAmount.trim()) {
    params.set("minAmount", filters.minAmount.trim());
  }
  if (filters.maxAmount.trim()) {
    params.set("maxAmount", filters.maxAmount.trim());
  }

  return params;
}

export type BillFilterSearchParams = {
  status?: string;
  search?: string;
  amountField?: string;
  minAmount?: string;
  maxAmount?: string;
};

export function billFiltersFromParams(params: BillFilterSearchParams): BillFilters {
  return {
    status: params.status ?? "",
    search: params.search ?? "",
    amountField: params.amountField === "deliveryAmount" ? "deliveryAmount" : "closingBalance",
    minAmount: params.minAmount ?? "",
    maxAmount: params.maxAmount ?? "",
  };
}

export function hasActiveBillFilters(filters: BillFilters): boolean {
  return (
    filters.status !== "" ||
    filters.search.trim() !== "" ||
    filters.minAmount.trim() !== "" ||
    filters.maxAmount.trim() !== ""
  );
}

// The line a printed sheet carries so nobody mistakes a partial list for the
// whole month. Reads as prose because it is handed to people.
export function describeBillFilters(filters: BillFilters): string | null {
  if (!hasActiveBillFilters(filters)) {
    return null;
  }

  const parts: string[] = [];

  if (filters.status) {
    parts.push(`${filters.status.charAt(0)}${filters.status.slice(1).toLowerCase()} bills only`);
  }
  if (filters.search.trim()) {
    parts.push(`matching "${filters.search.trim()}"`);
  }

  const fieldLabel = filters.amountField === "deliveryAmount" ? "bill amount" : "pending";
  const min = filters.minAmount.trim();
  const max = filters.maxAmount.trim();

  if (min && max) {
    parts.push(`${fieldLabel} between ₹${min} and ₹${max}`);
  } else if (min) {
    parts.push(`${fieldLabel} of ₹${min} or more`);
  } else if (max) {
    parts.push(`${fieldLabel} of ₹${max} or less`);
  }

  return `Filtered: ${parts.join(", ")}`;
}

// Totals over exactly the rows being shown.
//
// The loader's own totals cover the whole route, which is right for an
// unfiltered sheet and wrong the moment a filter hides a row — a Route Total
// that doesn't add up to the lines above it is worse than no total at all. So
// whenever a filter is active, the totals are recomputed from what survived.
export type SummableBillRow = {
  productQuantities: Record<string, string>;
  deliveryAmount: string;
  openingBalance: string;
  paymentAmount: string;
  pendingAmount: string;
};

export type SummedBillTotals = {
  productQuantities: Record<string, string>;
  deliveryAmount: string;
  openingBalance: string;
  paymentAmount: string;
  pendingAmount: string;
};

export function sumBillRows(rows: SummableBillRow[]): SummedBillTotals {
  const quantities = new Map<string, number>();
  let deliveryAmount = 0;
  let openingBalance = 0;
  let paymentAmount = 0;
  let pendingAmount = 0;

  for (const row of rows) {
    deliveryAmount += Number(row.deliveryAmount);
    openingBalance += Number(row.openingBalance);
    paymentAmount += Number(row.paymentAmount);
    pendingAmount += Number(row.pendingAmount);

    for (const [productId, qty] of Object.entries(row.productQuantities)) {
      quantities.set(productId, (quantities.get(productId) ?? 0) + Number(qty));
    }
  }

  return {
    // Quantities keep three decimals; money keeps two — the same precision the
    // loader stores them at, so a filtered total reads identically to an
    // unfiltered one.
    productQuantities: Object.fromEntries(
      [...quantities.entries()].map(([productId, qty]) => [productId, qty.toFixed(3)]),
    ),
    deliveryAmount: deliveryAmount.toFixed(2),
    openingBalance: openingBalance.toFixed(2),
    paymentAmount: paymentAmount.toFixed(2),
    pendingAmount: pendingAmount.toFixed(2),
  };
}
