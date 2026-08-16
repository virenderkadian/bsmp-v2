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

export type SequenceLine = {
  customerId: string;
  routeId: string;
  // Whether this route carries the customer's bill — see billsHere in
  // schema.prisma. Exactly one ACTIVE row per customer+month has it, enforced
  // by a partial unique index.
  billsHere: boolean;
};

// Which route carries each customer's single monthly bill.
//
// The row flagged billsHere wins. When nothing is flagged — legacy rows
// written before the flag existed — the earliest row is the fallback, so a
// customer always resolves to exactly ONE route and can never end up with two
// bills, which is the entire point of this.
//
// Shared by bill generation (buildBillPairs) and the Customer Summary, so the
// two can't drift into disagreeing about where a customer's bill lives. Input
// must be ordered oldest-first for the fallback to be meaningful.
export function resolveBillingRoutes(rows: SequenceLine[]): Map<string, string> {
  const billingRoute = new Map<string, string>();
  const firstRoute = new Map<string, string>();

  for (const row of rows) {
    if (!firstRoute.has(row.customerId)) {
      firstRoute.set(row.customerId, row.routeId);
    }
    if (row.billsHere && !billingRoute.has(row.customerId)) {
      billingRoute.set(row.customerId, row.routeId);
    }
  }

  for (const [customerId, routeId] of firstRoute) {
    if (!billingRoute.has(customerId)) {
      billingRoute.set(customerId, routeId);
    }
  }

  return billingRoute;
}

// The sequence rows a billing view should show: one per customer, on the route
// that bills them. A customer running a morning AND an evening route appears
// only under the billing one — on the other route they're simply absent from
// the billing view (their deliveries there still fold into that one bill, and
// Daily Entry, which drives the actual round, is untouched).
export function selectBillingRows<T extends { customerId: string; routeId: string }>(
  lines: T[],
  billingRoutes: Map<string, string>,
): T[] {
  return lines.filter((line) => billingRoutes.get(line.customerId) === line.routeId);
}

// The bills a run must touch — ONE per customer, keyed by customerId.
//
// Two invariants:
//
//  1. A customer gets a single bill even when they run on several routes in the
//     month (the normal morning + evening pairing). Deliveries from every route
//     are summed into it, and it's issued against the route flagged billsHere.
//     Keying by customer+route instead was a real production bug: a two-route
//     customer got TWO bills, and since openingBalance/paymentAmount are looked
//     up by CUSTOMER, both repeated the same opening balance and the same
//     payments (cus01: two bills each open=170 paid=1 close=169, so the office
//     read ₹338 owed against a real ₹169). Month-end carry-forward then took
//     whichever bill it saw first, dropping the other route's deliveries out of
//     the next month's opening balance entirely.
//
//  2. Everyone on a monthly sequence is billed even with no delivery data at
//     all, recomputed down to zero rather than left holding a stale nonzero
//     snapshot. Skipping absent customers was the earlier bug here: once a
//     customer's entries disappeared they never re-entered billMap, so
//     regenerating never touched their bill again.
export function buildBillPairs(
  billMap: Map<string, BillPair>,
  sequenceLines: SequenceLine[],
): Map<string, BillPair> {
  const billingRoutes = resolveBillingRoutes(sequenceLines);

  // `fallback` covers a customer with no sequence row at all — dropped from
  // every sequence but still holding deliveries, so the bill goes on the route
  // those deliveries actually happened on.
  const resolveRoute = (customerId: string, fallback: string): string =>
    billingRoutes.get(customerId) ?? fallback;

  const combined = new Map<string, BillPair>();
  const ensure = (customerId: string, routeId: string): BillPair => {
    const existing = combined.get(customerId);
    if (existing) {
      return existing;
    }
    const created: BillPair = { customerId, routeId, deliveryAmount: 0, items: new Map() };
    combined.set(customerId, created);
    return created;
  };

  for (const pair of billMap.values()) {
    const target = ensure(pair.customerId, resolveRoute(pair.customerId, pair.routeId));
    target.deliveryAmount += pair.deliveryAmount;
    for (const [productId, incoming] of pair.items) {
      const merged = target.items.get(productId) ?? { qty: 0, totalAmount: 0, rateTotal: 0, rateCount: 0 };
      merged.qty += incoming.qty;
      merged.totalAmount += incoming.totalAmount;
      // rateTotal/rateCount are summed rather than averaged here so the
      // averageRate computed downstream stays the true blend across routes.
      merged.rateTotal += incoming.rateTotal;
      merged.rateCount += incoming.rateCount;
      target.items.set(productId, merged);
    }
  }

  for (const line of sequenceLines) {
    ensure(line.customerId, resolveRoute(line.customerId, line.routeId));
  }

  return combined;
}

export type CalendarProductEntry = {
  productId: string;
  quantity: number;
  rateSnapshot: number;
};

export type CalendarDaySource = {
  skipped: boolean;
  entries: CalendarProductEntry[];
};

// Folds one calendar day's deliveries — possibly from SEVERAL routes — into a
// single set of per-product totals.
//
// Needed because a customer can be delivered on a morning and an evening route
// on the same date, while the printed bill has one row per date. Both callers
// previously built their day map with a plain `set`/`Map(...)`, so the second
// route's line silently replaced the first, and the day-by-day grid stopped
// adding up to the bill total it was printed beside.
//
// Quantities are summed. The rate is re-derived as amount/quantity, so a
// product delivered at different rates on the two routes still satisfies
// quantity × rate = amount, which is what the calendar cell renders and totals.
// A day counts as skipped only when every contributing route skipped it.
export function mergeCalendarDays(sources: CalendarDaySource[]): CalendarDaySource {
  const totals = new Map<string, { quantity: number; amount: number }>();

  for (const source of sources) {
    for (const entry of source.entries) {
      const current = totals.get(entry.productId) ?? { quantity: 0, amount: 0 };
      current.quantity += entry.quantity;
      current.amount += entry.quantity * entry.rateSnapshot;
      totals.set(entry.productId, current);
    }
  }

  return {
    skipped: sources.length > 0 && sources.every((source) => source.skipped),
    entries: [...totals.entries()].map(([productId, total]) => ({
      productId,
      quantity: total.quantity,
      // Guard the zero-quantity case (a recorded-but-empty line) so the rate
      // is 0 rather than NaN, which would render as an empty cell downstream.
      rateSnapshot: total.quantity === 0 ? 0 : total.amount / total.quantity,
    })),
  };
}

// Bills sitting on a route that no longer carries that customer, returned as
// ids to delete.
//
// Moving a customer's billing route (or removing the route that held it) leaves
// the old bill behind. Generation upserts by customer+route, so it writes a
// fresh bill on the NEW route and never touches the old one — and the customer
// is back to two bills, which is the exact problem this whole change removes.
//
// Callers must pass only bills that are safe to discard (DRAFT). A GENERATED or
// LOCKED bill has been issued to someone and needs a human decision, never a
// silent delete during a routine regeneration.
export function selectStaleDuplicateBills(
  bills: Array<{ id: string; customerId: string; routeId: string }>,
  billingRouteByCustomer: Map<string, string>,
): string[] {
  return bills
    .filter((bill) => {
      const billingRoute = billingRouteByCustomer.get(bill.customerId);
      // Unknown customer: not part of this run, so leave it alone rather than
      // deleting something this run knows nothing about.
      return billingRoute !== undefined && billingRoute !== bill.routeId;
    })
    .map((bill) => bill.id);
}
