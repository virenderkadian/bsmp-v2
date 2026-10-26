// Pure, DB-free matching logic — shared by the server (which builds the
// candidate pool) and the client screen (which matches an uploaded statement
// against it), and exercised directly by a unit test. No framework imports,
// so it's safe in either a server or a client bundle.

export type OutstandingCandidate = {
  customerId: string;
  customerCode: string;
  customerName: string;
  outstanding: number;
  // The route a resulting Payment gets attributed to — resolved from the
  // customer's earliest open bill (see getBankReconciliationPayload),
  // because Payment.routeId drives city-scoping in the collection ledger
  // (bill-ledger.ts's getCityCustomerLedger filters via the route relation),
  // so a route-less payment would silently not count toward anything.
  routeId: string;
};

export type StatementRow = {
  rowIndex: number;
  date: string; // YYYY-MM-DD
  amount: number;
  narration: string;
};

export type MatchedRow = StatementRow & {
  candidates: OutstandingCandidate[];
};

const AMOUNT_EPSILON = 0.01;

function amountsMatch(a: number, b: number) {
  return Math.abs(a - b) < AMOUNT_EPSILON;
}

// Matches each statement row to every outstanding customer whose balance
// equals the row's amount. `excludedCustomerIds` removes a customer already
// confirmed for an earlier row of the same amount in this same batch, so the
// same person isn't suggested twice when a statement has several payments of
// an identical amount — the operator can still pick them again manually if
// that's genuinely correct (e.g. two separate real payments).
export function matchStatementRows(
  rows: StatementRow[],
  candidates: readonly OutstandingCandidate[],
  excludedCustomerIds: ReadonlySet<string> = new Set(),
): MatchedRow[] {
  return rows.map((row) => ({
    ...row,
    candidates: candidates.filter(
      (candidate) => amountsMatch(candidate.outstanding, row.amount) && !excludedCustomerIds.has(candidate.customerId),
    ),
  }));
}
