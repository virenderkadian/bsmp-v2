// The one rule for "what does this customer still owe, and on which route?".
// The driver app's dues screens and the web monthly-bill summary both read it,
// so the two can never disagree.
//
// A bill's closingBalance already contains every earlier month's balance (the
// next bill opens with the previous closing), so a customer's debt is their
// LATEST issued bill — never the sum of several. Adding the bills up counted the
// same rupees twice, and counted a month that was paid off later as still owed.
//
// Only a GENERATED bill is collectable. A LOCKED bill is closed; whatever it
// left unpaid carries into the next bill's opening balance and is collected
// there. A DRAFT or CANCELLED bill was never issued to the customer.

export type IssuedBill = {
  billId: string;
  customerId: string;
  routeId: string;
  month: string; // YYYY-MM
  status: "GENERATED" | "LOCKED";
  paymentAmount: number; // payments the bill already accounts for
  closingBalance: number;
};

// Verified money received for the customer, all time, and the part of it that
// is frozen into LOCKED bills (see bill-ledger.ts for the model).
export type CustomerPayments = { totalVerified: number; lockedPaid: number };

const cents = (value: number) => Math.round(value * 100) / 100;

// The customer's latest issued bill, by month.
export function latestIssuedBills(bills: IssuedBill[]): Map<string, IssuedBill> {
  const latest = new Map<string, IssuedBill>();
  for (const bill of bills) {
    const current = latest.get(bill.customerId);
    if (!current || bill.month > current.month) {
      latest.set(bill.customerId, bill);
    }
  }
  return latest;
}

// What is still owed on a GENERATED bill: its closing balance, less money
// verified since it was generated that it doesn't already include.
//
// A LOCKED bill's own payments are already inside `lockedPaid`, so everything
// left in the open ledger came after it; a GENERATED bill's payments are still
// in the open ledger, so what it already accounts for is taken off first.
export function outstandingOnBill(bill: IssuedBill, payments: CustomerPayments | undefined): number {
  const receivedAgainstOpenBill = Math.max(0, (payments?.totalVerified ?? 0) - (payments?.lockedPaid ?? 0));
  const alreadyInBill = bill.status === "LOCKED" ? 0 : bill.paymentAmount;
  const since = Math.max(0, receivedAgainstOpenBill - alreadyInBill);
  return cents(bill.closingBalance - since);
}

export type CustomerDue = { bill: IssuedBill; outstanding: number };

// Customers who owe on their latest bill. `payments` is keyed by customer.
export function customersOwing(bills: IssuedBill[], payments: Map<string, CustomerPayments>): Map<string, CustomerDue> {
  const owing = new Map<string, CustomerDue>();
  for (const [customerId, bill] of latestIssuedBills(bills)) {
    if (bill.status !== "GENERATED") {
      continue;
    }
    const outstanding = outstandingOnBill(bill, payments.get(customerId));
    if (outstanding > 0) {
      owing.set(customerId, { bill, outstanding });
    }
  }
  return owing;
}
