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
