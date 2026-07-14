// Pure calculation core of monthly bill generation, split out of
// src/app/monthly-bills/actions.ts so this money math can be unit tested
// without a database. Both pieces here fixed real production bugs this
// session (see memory: daily-entry-bill-lock-guard) — this file exists to
// keep them fixed as the code around them changes.

export function computeClosingBalance(openingBalance: number, deliveryAmount: number, paymentAmount: number) {
  return openingBalance + deliveryAmount - paymentAmount;
}

export type BillPair = {
  customerId: string;
  routeId: string;
  deliveryAmount: number;
  items: Map<string, { qty: number; totalAmount: number; rateTotal: number; rateCount: number }>;
};

// The customer/route pairs a bill run must touch: everyone with delivery
// data this month, UNIONED with everyone on the route's monthly customer
// sequence — the authoritative "who should be billed" list — even if they
// have zero entries. A customer with zero entries must still be recomputed
// (down to zero), not silently left with whatever their last bill happened
// to say. Skipping absent customers here was the original bug: once a
// customer's entries disappeared, regenerating never touched their bill
// again because they'd never re-enter billMap.
export function buildBillPairs(
  billMap: Map<string, BillPair>,
  sequenceLines: Array<{ customerId: string; routeId: string }>,
): Map<string, BillPair> {
  const billPairs = new Map(billMap);

  sequenceLines.forEach((line) => {
    const key = `${line.customerId}:${line.routeId}`;
    if (!billPairs.has(key)) {
      billPairs.set(key, {
        customerId: line.customerId,
        routeId: line.routeId,
        deliveryAmount: 0,
        items: new Map(),
      });
    }
  });

  return billPairs;
}
