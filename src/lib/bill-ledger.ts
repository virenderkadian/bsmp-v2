// Collection ledger used by bill generation, locking, and the live summary.
//
// Model: a customer's currently-open (not LOCKED) bill absorbs every verified
// payment that hasn't already been frozen into an earlier LOCKED bill. So:
//
//   received-against-open-bill = (all VERIFIED payments for the customer)
//                              − (Σ paymentAmount of that customer's LOCKED bills)
//
// Locked bills keep their frozen paymentAmount/closing (which is what carries
// forward as the next month's opening). This needs no per-payment tagging and
// no schema change — the lock status is the boundary.

// Minimal structural client type — see the note in src/lib/customer-code.ts for
// why this isn't Prisma.TransactionClient/PrismaClient. Both the extended
// client and a $transaction tx client satisfy this shape.
type LedgerClient = {
  payment: {
    findMany: (args: {
      where: { status: "VERIFIED"; route: { cityId: string } };
      select: { customerId: true; amount: true };
    }) => Promise<Array<{ customerId: string; amount: unknown }>>;
  };
  monthlyBill: {
    findMany: (args: {
      where: { status: "LOCKED"; route: { cityId: string } };
      select: { customerId: true; paymentAmount: true };
    }) => Promise<Array<{ customerId: string; paymentAmount: unknown }>>;
  };
};

export type CustomerLedger = {
  // Sum of every VERIFIED payment for the customer (all dates, all routes).
  totalVerified: number;
  // Sum of the customer's LOCKED bills' frozen paymentAmount.
  lockedPaid: number;
};

// Per-customer totals for the whole city.
export async function getCityCustomerLedger(
  client: LedgerClient,
  cityId: string,
): Promise<Map<string, CustomerLedger>> {
  const [payments, lockedBills] = await Promise.all([
    client.payment.findMany({
      where: { status: "VERIFIED", route: { cityId } },
      select: { customerId: true, amount: true },
    }),
    client.monthlyBill.findMany({
      where: { status: "LOCKED", route: { cityId } },
      select: { customerId: true, paymentAmount: true },
    }),
  ]);

  const ledger = new Map<string, CustomerLedger>();
  const ensure = (customerId: string) => {
    const existing = ledger.get(customerId);
    if (existing) {
      return existing;
    }
    const created = { totalVerified: 0, lockedPaid: 0 };
    ledger.set(customerId, created);
    return created;
  };

  for (const payment of payments) {
    ensure(payment.customerId).totalVerified += Number(payment.amount);
  }
  for (const bill of lockedBills) {
    ensure(bill.customerId).lockedPaid += Number(bill.paymentAmount);
  }

  return ledger;
}

// Amount collected against a customer's current open bill = everything not yet
// frozen into a locked bill. Never negative (a fully-paid customer reads 0 for
// a freshly opened next bill).
export function receivedAgainstOpenBill(ledger: CustomerLedger | undefined): number {
  if (!ledger) {
    return 0;
  }
  return Math.max(0, ledger.totalVerified - ledger.lockedPaid);
}

// A minimal client type for the single-customer path — the where clauses carry
// customerId as well as cityId, so it is not the same shape as LedgerClient
// above and can't reuse it.
type SingleCustomerLedgerClient = {
  payment: {
    findMany: (args: {
      where: { status: "VERIFIED"; customerId: string; route: { cityId: string } };
      select: { amount: true };
    }) => Promise<Array<{ amount: unknown }>>;
  };
  monthlyBill: {
    findMany: (args: {
      where: { status: "LOCKED"; customerId: string; route: { cityId: string } };
      select: { paymentAmount: true };
    }) => Promise<Array<{ paymentAmount: unknown }>>;
  };
};

// The same totals as getCityCustomerLedger's per-customer entry, scoped to one
// customer at the query level rather than pulling every payment and locked
// bill in the city to read a single entry back out of the map. Used where a
// caller only ever needs one customer's figures — a single-customer bill
// generate, most immediately.
export async function getSingleCustomerLedger(
  client: SingleCustomerLedgerClient,
  cityId: string,
  customerId: string,
): Promise<CustomerLedger> {
  const [payments, lockedBills] = await Promise.all([
    client.payment.findMany({
      where: { status: "VERIFIED", customerId, route: { cityId } },
      select: { amount: true },
    }),
    client.monthlyBill.findMany({
      where: { status: "LOCKED", customerId, route: { cityId } },
      select: { paymentAmount: true },
    }),
  ]);

  return {
    totalVerified: payments.reduce((total, payment) => total + Number(payment.amount), 0),
    lockedPaid: lockedBills.reduce((total, bill) => total + Number(bill.paymentAmount), 0),
  };
}
