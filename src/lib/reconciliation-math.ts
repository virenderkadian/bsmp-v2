// Pure calculation core of vehicle reconciliation, split out of
// src/lib/reconciliation.ts so the money math can be unit tested without a
// database. See memory: this given/delivered/returned/cash-sale formula was
// hand-verified against a real worked example when the feature shipped —
// this file exists to keep it that way as the code around it changes.

export function computeLeftover(input: {
  given: number;
  eveningDelivered: number;
  morningDelivered: number;
  returned: number;
}) {
  return input.given - input.eveningDelivered - input.morningDelivered - input.returned;
}

export function computeLeftoverValue(leftover: number, rate: number) {
  return leftover * rate;
}

export function computeVehicleBalance(cashSaleAmount: number, paymentsReceived: number) {
  return cashSaleAmount - paymentsReceived;
}

// Range aggregation for the vehicle cash report.
//
// Deliberately built on computeLeftover above rather than repeating the sum:
// if the daily screen and the monthly report ever computed a day differently,
// they would disagree about the same figure with no way to tell which was
// right.

export type CashReportDayProduct = {
  productId: string;
  given: number;
  delivered: number;
  returned: number;
  rate: number;
};

export type CashReportDay = {
  date: string;
  // False when no stock was recorded for this day at all. Such a day is shown
  // — the deliveries still happened and hiding them would misrepresent the
  // round — but it cannot contribute to the cash figures, because there is no
  // "given" to measure a leftover against. Counting it would compute a large
  // negative leftover and drag the amount owed below the truth, which matters
  // while stock entry is still being migrated vehicle by vehicle.
  stockRecorded: boolean;
  products: CashReportDayProduct[];
  deposited: number;
};

export type CashReportProductTotal = {
  productId: string;
  taken: number;
  distributed: number;
  returned: number;
  cashQty: number;
  cashAmount: number;
};

export type CashReportTotals = {
  products: CashReportProductTotal[];
  totalCash: number;
  totalDeposited: number;
  owed: number;
  daysRecorded: number;
  daysMissingStock: number;
};

export function summariseCashReport(days: CashReportDay[]): CashReportTotals {
  const products = new Map<string, CashReportProductTotal>();
  let totalCash = 0;
  let totalDeposited = 0;
  let daysRecorded = 0;
  let daysMissingStock = 0;

  for (const day of days) {
    // Deposits count whether or not stock was recorded — the money was handed
    // over regardless of whether the paperwork behind it has been entered yet.
    totalDeposited += day.deposited;

    if (!day.stockRecorded) {
      daysMissingStock += 1;
      continue;
    }
    daysRecorded += 1;

    for (const entry of day.products) {
      const leftover = computeLeftover({
        given: entry.given,
        eveningDelivered: entry.delivered,
        morningDelivered: 0,
        returned: entry.returned,
      });
      const current =
        products.get(entry.productId) ??
        { productId: entry.productId, taken: 0, distributed: 0, returned: 0, cashQty: 0, cashAmount: 0 };

      current.taken += entry.given;
      current.distributed += entry.delivered;
      current.returned += entry.returned;
      current.cashQty += leftover;
      current.cashAmount += computeLeftoverValue(leftover, entry.rate);
      products.set(entry.productId, current);

      totalCash += computeLeftoverValue(leftover, entry.rate);
    }
  }

  return {
    products: [...products.values()],
    totalCash,
    totalDeposited,
    owed: computeVehicleBalance(totalCash, totalDeposited),
    daysRecorded,
    daysMissingStock,
  };
}
