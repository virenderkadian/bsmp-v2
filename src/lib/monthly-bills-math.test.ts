import { describe, expect, it } from "vitest";
import { buildBillPairs, computeClosingBalance, type BillPair } from "@/lib/monthly-bills-math";

describe("computeClosingBalance", () => {
  it("matches the real cus01 correction from this session (0 opening, 0 delivered, 3000 paid -> -3000 in credit)", () => {
    expect(computeClosingBalance(0, 0, 3000)).toBe(-3000);
  });

  it("adds delivery amount and subtracts payments against the opening balance", () => {
    expect(computeClosingBalance(500, 2000, 1200)).toBe(1300);
  });
});

describe("buildBillPairs", () => {
  const emptyBill = (customerId: string, routeId: string): BillPair => ({
    customerId,
    routeId,
    deliveryAmount: 0,
    items: new Map(),
  });

  it("keeps a customer's real delivery data when they're in both billMap and the sequence", () => {
    const billMap = new Map([
      ["cust-1:route-1", { customerId: "cust-1", routeId: "route-1", deliveryAmount: 500, items: new Map() }],
    ]);
    const sequenceLines = [{ customerId: "cust-1", routeId: "route-1" }];

    const result = buildBillPairs(billMap, sequenceLines);

    expect(result.get("cust-1:route-1")?.deliveryAmount).toBe(500);
  });

  it("regression: synthesizes a zero-value entry for a sequence customer missing from billMap (the cus01 bug)", () => {
    // This is the exact failure mode fixed this session: a customer whose
    // daily entries disappeared never re-entered billMap, so regenerating
    // bills silently never touched their stale nonzero snapshot again.
    const billMap = new Map<string, BillPair>();
    const sequenceLines = [{ customerId: "cus01", routeId: "route-1" }];

    const result = buildBillPairs(billMap, sequenceLines);

    expect(result.has("cus01:route-1")).toBe(true);
    expect(result.get("cus01:route-1")?.deliveryAmount).toBe(0);
  });

  it("does not touch customers who have entries but aren't in the current sequence", () => {
    const billMap = new Map([
      ["cust-2:route-1", emptyBill("cust-2", "route-1")],
    ]);
    billMap.get("cust-2:route-1")!.deliveryAmount = 750;
    const sequenceLines: Array<{ customerId: string; routeId: string }> = [];

    const result = buildBillPairs(billMap, sequenceLines);

    expect(result.get("cust-2:route-1")?.deliveryAmount).toBe(750);
    expect(result.size).toBe(1);
  });
});
