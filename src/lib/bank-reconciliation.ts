import "server-only";
import { getCurrentCityId } from "@/lib/current-city";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";
import type { OutstandingCandidate } from "@/lib/bank-statement-matching";

export type BankReconciliationPayload = {
  dbConnected: boolean;
  candidates: OutstandingCandidate[];
  error?: string;
};

// Candidate pool for matching a bank statement: every customer with a
// currently open (not yet LOCKED) bill, one row per customer with their open
// bills' balances summed.
//
// Deliberately NOT lib/bill-ledger.ts's getCityCustomerLedger — that sums
// every VERIFIED payment and every LOCKED bill ever recorded for the city,
// unbounded and growing every month (the same query shape behind the
// September 2026 egress overage). This instead reads only currently-open
// bills, bounded by how many are unpaid right now rather than by all-time
// history.
export async function getBankReconciliationPayload(): Promise<BankReconciliationPayload> {
  try {
    const cityId = await getCurrentCityId();

    const openBills = await withDbTimeout(
      prisma.monthlyBill.findMany({
        where: { route: { cityId }, status: { in: ["DRAFT", "GENERATED"] } },
        orderBy: { billingMonth: "asc" },
        select: {
          customerId: true,
          routeId: true,
          closingBalance: true,
          customer: { select: { code: true, name: true } },
        },
      }),
      "Bank reconciliation: open bills request",
    );

    const byCustomer = new Map<string, OutstandingCandidate>();
    for (const bill of openBills) {
      const existing = byCustomer.get(bill.customerId);
      if (existing) {
        // A second, later open month for the same customer — fold its
        // balance in, but keep the earlier bill's route: money settles
        // against the earliest open month first, same convention as
        // getBillQuickView's settlesOn in lib/payments.ts.
        existing.outstanding += Number(bill.closingBalance);
      } else {
        byCustomer.set(bill.customerId, {
          customerId: bill.customerId,
          customerCode: bill.customer.code,
          customerName: bill.customer.name,
          outstanding: Number(bill.closingBalance),
          routeId: bill.routeId,
        });
      }
    }

    const candidates = [...byCustomer.values()].filter((candidate) => candidate.outstanding > 0);

    return { dbConnected: true, candidates };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load outstanding balances.";
    return { dbConnected: false, candidates: [], error: message };
  }
}
