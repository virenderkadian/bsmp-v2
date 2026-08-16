// Deciding which restored monthly-sequence rows may carry the billing flag.
//
// Kept out of restore.ts (which is "server-only", so tests can't import it)
// because this is the part that can silently corrupt data and therefore the
// part worth testing directly.
//
// The problem: MonthlyRouteCustomerSequence has a PARTIAL unique index — at
// most one ACTIVE row per (customerId, sequenceMonth) may have billsHere =
// true. A restore can violate it two ways:
//
//   1. The archive holds several routes for one customer in the month, and
//      each row claims the flag.
//   2. The archive predates the column entirely, so every row deserializes
//      without billsHere and picks up the default — which is true.
//
// Either throws mid-transaction. Worse, "fixing" it with skipDuplicates would
// silently drop rows instead: that exact mistake in the E2E fixture helper
// inserted one of two routes while the caller believed it had both.

export type ArchivedSequenceRow = Record<string, unknown>;

// Stable identity for the index's scope. Dates arrive as ISO strings from
// JSONL, so they're normalised to a day before comparing.
export function sequenceBillingKey(row: ArchivedSequenceRow): string | null {
  const customerId = typeof row.customerId === "string" ? row.customerId : null;
  const rawMonth = row.sequenceMonth;

  if (!customerId) {
    return null;
  }

  if (typeof rawMonth !== "string" && !(rawMonth instanceof Date)) {
    return null;
  }

  const month = new Date(rawMonth as string | Date);

  if (Number.isNaN(month.getTime())) {
    return null;
  }

  return `${customerId}:${month.toISOString().slice(0, 10)}`;
}

function isActiveRow(row: ArchivedSequenceRow): boolean {
  // Absent status means the column default, which is ACTIVE.
  return row.status === undefined || row.status === null || row.status === "ACTIVE";
}

// Returns the rows with billsHere resolved so at most one ACTIVE row per
// customer+month claims it — counting rows ALREADY in the database, not just
// the ones being restored.
//
// A row that wanted the flag but can't have it is still restored, just as a
// non-billing route. That's the deliberate trade: the customer keeps every
// route they were on, and their bill stays wherever it already is, rather than
// the restore failing outright or dropping the row.
export function resolveRestoredSequenceFlags(
  rows: ArchivedSequenceRow[],
  claimedKeys: Iterable<string>,
): ArchivedSequenceRow[] {
  const claimed = new Set(claimedKeys);

  return rows.map((row) => {
    // Only an explicit false declines the flag — an archive written before the
    // column existed has no value at all and would otherwise default to true.
    const wantsFlag = row.billsHere !== false;
    const key = sequenceBillingKey(row);
    const active = isActiveRow(row);

    // Inactive rows are outside the partial index, so they can't collide and
    // don't consume the claim.
    if (!active) {
      return { ...row, billsHere: wantsFlag };
    }

    const canClaim = wantsFlag && key !== null && !claimed.has(key);

    if (canClaim && key !== null) {
      claimed.add(key);
    }

    return { ...row, billsHere: canClaim };
  });
}

// The customer+month keys that already have a billing row in the database, in
// the same format resolveRestoredSequenceFlags expects.
export function existingBillingKeys(
  rows: Array<{ customerId: string; sequenceMonth: Date }>,
): string[] {
  return rows.map((row) => `${row.customerId}:${row.sequenceMonth.toISOString().slice(0, 10)}`);
}
