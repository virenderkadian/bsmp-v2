import { describe, expect, it } from "vitest";
import { customersOwing, outstandingOnBill, type CustomerPayments, type IssuedBill } from "@/lib/customer-dues";

const bill = (over: Partial<IssuedBill> & Pick<IssuedBill, "month">): IssuedBill => ({
  billId: `bill-${over.month}`, customerId: "c1", routeId: "r1", status: "GENERATED", paymentAmount: 0, closingBalance: 0, ...over,
});
const none = new Map<string, CustomerPayments>();

describe("customersOwing", () => {
  it("counts only the latest bill, not the sum of every unpaid month", () => {
    // ROHTAKCID0142 in production: Sep closed at 5277.50, Oct opened with it.
    const owing = customersOwing([
      bill({ month: "2026-09", closingBalance: 5277.5 }),
      bill({ month: "2026-10", closingBalance: 7742.5 }),
    ], none);
    expect(owing.get("c1")?.outstanding).toBe(7742.5);
    expect(owing.get("c1")?.bill.billId).toBe("bill-2026-10");
  });

  it("ignores an older unpaid bill once a later bill shows the customer settled", () => {
    const owing = customersOwing([
      bill({ month: "2026-08", closingBalance: 2155 }),
      bill({ month: "2026-09", status: "LOCKED", closingBalance: 0 }),
      bill({ month: "2026-10", closingBalance: 127.5 }),
    ], none);
    expect(owing.get("c1")?.outstanding).toBe(127.5);
  });

  it("does not collect on a locked latest bill", () => {
    expect(customersOwing([bill({ month: "2026-10", status: "LOCKED", closingBalance: 900 })], none).size).toBe(0);
  });

  it("puts the customer on the route of the latest bill", () => {
    const owing = customersOwing([
      bill({ month: "2026-09", routeId: "r-old", closingBalance: 300 }),
      bill({ month: "2026-10", routeId: "r-new", closingBalance: 500 }),
    ], none);
    expect(owing.get("c1")?.bill.routeId).toBe("r-new");
  });

  it("subtracts money verified after the bill was generated", () => {
    const payments = new Map([["c1", { totalVerified: 1500, lockedPaid: 500 }]]);
    // 1000 received against the open bill, 400 of it already in the bill.
    const owing = customersOwing([bill({ month: "2026-10", paymentAmount: 400, closingBalance: 3000 })], payments);
    expect(owing.get("c1")?.outstanding).toBe(2400);
  });

  it("drops a customer whose later payments cover the balance", () => {
    const payments = new Map([["c1", { totalVerified: 800, lockedPaid: 0 }]]);
    expect(customersOwing([bill({ month: "2026-10", closingBalance: 800 })], payments).size).toBe(0);
  });

  it("does not subtract payments the bill already contains", () => {
    const payments = new Map([["c1", { totalVerified: 4040, lockedPaid: 0 }]]);
    const owing = customersOwing([bill({ month: "2026-10", paymentAmount: 4040, closingBalance: 127.5 })], payments);
    expect(owing.get("c1")?.outstanding).toBe(127.5);
  });

  it("takes only post-lock receipts off a locked bill", () => {
    // 2000 verified in all; 1800 is frozen into the locked bill, 200 arrived after.
    const locked = bill({ month: "2026-09", status: "LOCKED", paymentAmount: 1800, closingBalance: 900 });
    expect(outstandingOnBill(locked, { totalVerified: 2000, lockedPaid: 1800 })).toBe(700);
  });

  it("keeps customers separate", () => {
    const owing = customersOwing([
      bill({ month: "2026-10", closingBalance: 100 }),
      bill({ month: "2026-10", customerId: "c2", billId: "b2", closingBalance: 200 }),
    ], none);
    expect([...owing.keys()].sort()).toEqual(["c1", "c2"]);
  });
});
