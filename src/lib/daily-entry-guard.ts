import "server-only";
import type { BillingStatus, Prisma } from "@prisma/client";
import { ABSENT_SIGNATURE } from "@/lib/daily-entry-diff";

// Structural rather than PrismaClient/TransactionClient directly — same
// reasoning as src/lib/audit.ts: the city-scope guard in src/lib/prisma.ts
// wraps the client in $extends(), which makes every call site's client type
// structurally compatible but not nominally identical to Prisma's own
// types. Depending only on the methods actually called here sidesteps that.
type GuardClient = {
  monthlyBill: {
    findMany: (args: {
      where: {
        customerId: { in: string[] };
        billingMonth: Date;
        status: { in: BillingStatus[] };
        route: { cityId: string };
      };
      select: { customerId: true; status: true };
    }) => Promise<Array<{ customerId: string; status: string }>>;
  };
};

export type FrozenBillSubject = {
  // The caller's own identifier for one stored/submitted comparison — a
  // customerId for a route-wide save (one date, many customers), a
  // DailyRouteEntryLine id for a customer-month save (one customer, many
  // dates). Only used to report back which subjects are blocked; the guard
  // itself keys everything else off customerId.
  key: string;
  customerId: string;
  storedSignature: string;
  submittedSignature: string;
};

export type FrozenBillGuardResult =
  | { blocked: false }
  | { blocked: true; anyLocked: boolean; changedKeys: string[]; changedCustomerIds: string[] };

// A bill already Generated/Locked is a frozen snapshot with no link back to
// the source rows it was built from — if a save silently changed what was
// delivered underneath it, the bill's totals would stay while the trail
// beneath them shifted. This blocks only the subjects that would ACTUALLY
// change a frozen bill's numbers (same delivery resubmitted as identical
// values passes straight through), whether called once per date across many
// customers (saveDailyEntry) or once per customer across many dates
// (saveCustomerMonthEntries) — same primitive, different fan-out.
export async function checkFrozenBillGuard(
  tx: GuardClient,
  params: { cityId: string; billingMonth: Date; subjects: FrozenBillSubject[] },
): Promise<FrozenBillGuardResult> {
  const customerIds = [...new Set(params.subjects.map((subject) => subject.customerId))];

  if (customerIds.length === 0) {
    return { blocked: false };
  }

  const frozenBills = await tx.monthlyBill.findMany({
    where: {
      customerId: { in: customerIds },
      billingMonth: params.billingMonth,
      status: { in: ["GENERATED", "LOCKED"] },
      route: { cityId: params.cityId },
    },
    select: { customerId: true, status: true },
  });

  if (frozenBills.length === 0) {
    return { blocked: false };
  }

  const frozenCustomerIds = new Set(frozenBills.map((bill) => bill.customerId));
  const changedSubjects = params.subjects.filter(
    (subject) => frozenCustomerIds.has(subject.customerId) && subject.storedSignature !== subject.submittedSignature,
  );

  if (changedSubjects.length === 0) {
    return { blocked: false };
  }

  return {
    blocked: true,
    anyLocked: frozenBills.some((bill) => bill.status === "LOCKED"),
    changedKeys: changedSubjects.map((subject) => subject.key),
    changedCustomerIds: [...new Set(changedSubjects.map((subject) => subject.customerId))],
  };
}

// Re-exported so callers that build signatures for the guard above don't
// need a second import just for the "nothing delivered" sentinel.
export { ABSENT_SIGNATURE };

type RecentOrderClient = {
  customerProductRecentOrder: {
    findMany: (args: {
      where: { OR: Array<{ customerId: string; productId: string }> };
      select: { customerId: true; productId: true; entries: true };
    }) => Promise<Array<{ customerId: string; productId: string; entries: Prisma.JsonValue }>>;
    upsert: (args: {
      where: { customerId_productId: { customerId: string; productId: string } };
      create: { customerId: string; productId: string; entries: Prisma.InputJsonValue };
      update: { entries: Prisma.InputJsonValue };
    }) => Promise<unknown>;
  };
};

export type RecentOrderChange = {
  customerId: string;
  productId: string;
  date: string;
  newQty: number;
};

// Keeps CustomerProductRecentOrder (see schema.prisma) in step with what was
// just saved — this is what "usual order"/"unusual quantity" in Daily Entry
// reads instead of re-scanning 45 days of raw deliveries on every page load.
// Scoped to only the (customer, product) pairs that actually changed this
// save, each carrying its own date rather than one shared date, so a save
// that touches several different dates at once (a customer-month correction)
// re-sorts correctly instead of assuming every change belongs to "today".
export async function updateRecentOrderCache(tx: RecentOrderClient, changes: RecentOrderChange[]): Promise<void> {
  if (changes.length === 0) {
    return;
  }

  const existingOrders = await tx.customerProductRecentOrder.findMany({
    where: { OR: changes.map((change) => ({ customerId: change.customerId, productId: change.productId })) },
    select: { customerId: true, productId: true, entries: true },
  });
  const existingByKey = new Map(
    existingOrders.map((row) => [
      `${row.customerId}:${row.productId}`,
      row.entries as unknown as Array<{ date: string; quantity: number }>,
    ]),
  );

  for (const change of changes) {
    const key = `${change.customerId}:${change.productId}`;
    const current = existingByKey.get(key) ?? [];
    // Drop any entry already on file for this exact date first — a resave of
    // the same day (an edit/correction) replaces it rather than appending a
    // duplicate.
    const withoutThatDate = current.filter((item) => item.date !== change.date);
    const next =
      change.newQty > 0 ? [{ date: change.date, quantity: change.newQty }, ...withoutThatDate] : withoutThatDate;
    // Re-sorted rather than trusted as already-ordered: a save can touch a
    // backdated date, which wouldn't belong at the front.
    next.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const capped = next.slice(0, 10) as Prisma.InputJsonValue;

    await tx.customerProductRecentOrder.upsert({
      where: { customerId_productId: { customerId: change.customerId, productId: change.productId } },
      create: { customerId: change.customerId, productId: change.productId, entries: capped },
      update: { entries: capped },
    });
  }
}
