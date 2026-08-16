import { describe, expect, it } from "vitest";
import {
  buildBillPairs,
  computeClosingBalance,
  mergeCalendarDays,
  resolveBillingRoutes,
  selectStaleDuplicateBills,
  selectBillingRows,
  type BillPair,
} from "@/lib/monthly-bills-math";

describe("computeClosingBalance", () => {
  it("matches the real cus01 correction from this session (0 opening, 0 delivered, 3000 paid -> -3000 in credit)", () => {
    expect(computeClosingBalance(0, 0, 3000)).toBe(-3000);
  });

  it("adds delivery amount and subtracts payments against the opening balance", () => {
    expect(computeClosingBalance(500, 2000, 1200)).toBe(1300);
  });
});

const item = (qty: number, totalAmount: number, rateTotal: number, rateCount: number) => ({
  qty,
  totalAmount,
  rateTotal,
  rateCount,
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
    const sequenceLines = [{ customerId: "cust-1", routeId: "route-1", billsHere: true }];

    const result = buildBillPairs(billMap, sequenceLines);

    expect(result.get("cust-1")?.deliveryAmount).toBe(500);
    expect(result.get("cust-1")?.routeId).toBe("route-1");
  });

  it("regression: synthesizes a zero-value entry for a sequence customer missing from billMap (the cus01 bug)", () => {
    // A customer whose daily entries disappeared never re-entered billMap, so
    // regenerating bills silently never touched their stale nonzero snapshot.
    const billMap = new Map<string, BillPair>();
    const sequenceLines = [{ customerId: "cus01", routeId: "route-1", billsHere: true }];

    const result = buildBillPairs(billMap, sequenceLines);

    expect(result.has("cus01")).toBe(true);
    expect(result.get("cus01")?.deliveryAmount).toBe(0);
  });

  it("does not touch customers who have entries but aren't in the current sequence", () => {
    const billMap = new Map([["cust-2:route-1", emptyBill("cust-2", "route-1")]]);
    billMap.get("cust-2:route-1")!.deliveryAmount = 750;
    const sequenceLines: Array<{ customerId: string; routeId: string; billsHere: boolean }> = [];

    const result = buildBillPairs(billMap, sequenceLines);

    // Still billed — on the route the deliveries actually happened on, since
    // there's no sequence row left to say otherwise.
    expect(result.get("cust-2")?.deliveryAmount).toBe(750);
    expect(result.get("cust-2")?.routeId).toBe("route-1");
    expect(result.size).toBe(1);
  });
});

// The bug these cover, from real production data: a customer on a morning AND
// an evening route got TWO bills, while openingBalance/paymentAmount are keyed
// by CUSTOMER — so both bills repeated the same opening balance and the same
// payments (cus01: two bills each open=170, paid=1, close=169, so the office
// saw ₹338 owed instead of ₹169). Worse, month-end carry-forward takes the
// first bill it finds per customer, so one route's deliveries silently
// vanished from the next month's opening balance.
describe("buildBillPairs — one combined bill per customer (morning + evening)", () => {
  it("combines deliveries from both routes into a single bill on the billing route", () => {
    const billMap = new Map<string, BillPair>([
      ["cust-1:route-morning", { customerId: "cust-1", routeId: "route-morning", deliveryAmount: 1020, items: new Map() }],
      ["cust-1:route-evening", { customerId: "cust-1", routeId: "route-evening", deliveryAmount: 680, items: new Map() }],
    ]);
    const sequenceLines = [
      { customerId: "cust-1", routeId: "route-morning", billsHere: true },
      { customerId: "cust-1", routeId: "route-evening", billsHere: false },
    ];

    const result = buildBillPairs(billMap, sequenceLines);

    // Exactly ONE bill — this is the whole point.
    expect(result.size).toBe(1);
    expect(result.get("cust-1")?.deliveryAmount).toBe(1700);
    expect(result.get("cust-1")?.routeId).toBe("route-morning");
  });

  it("issues the combined bill on whichever route is flagged, not the one with more deliveries", () => {
    const billMap = new Map<string, BillPair>([
      ["cust-1:route-morning", { customerId: "cust-1", routeId: "route-morning", deliveryAmount: 1020, items: new Map() }],
      ["cust-1:route-evening", { customerId: "cust-1", routeId: "route-evening", deliveryAmount: 680, items: new Map() }],
    ]);
    const sequenceLines = [
      { customerId: "cust-1", routeId: "route-morning", billsHere: false },
      { customerId: "cust-1", routeId: "route-evening", billsHere: true },
    ];

    const result = buildBillPairs(billMap, sequenceLines);

    expect(result.size).toBe(1);
    expect(result.get("cust-1")?.routeId).toBe("route-evening");
    expect(result.get("cust-1")?.deliveryAmount).toBe(1700);
  });

  it("merges per-product items across routes, keeping the rate average correct", () => {
    const billMap = new Map<string, BillPair>([
      [
        "cust-1:route-morning",
        {
          customerId: "cust-1",
          routeId: "route-morning",
          deliveryAmount: 850,
          items: new Map([["milk", item(10, 850, 85, 1)]]),
        },
      ],
      [
        "cust-1:route-evening",
        {
          customerId: "cust-1",
          routeId: "route-evening",
          deliveryAmount: 750,
          items: new Map([
            ["milk", item(10, 750, 75, 1)],
            ["dahi", item(2, 120, 60, 1)],
          ]),
        },
      ],
    ]);
    const sequenceLines = [
      { customerId: "cust-1", routeId: "route-morning", billsHere: true },
      { customerId: "cust-1", routeId: "route-evening", billsHere: false },
    ];

    const result = buildBillPairs(billMap, sequenceLines);
    const milk = result.get("cust-1")?.items.get("milk");

    expect(milk?.qty).toBe(20);
    expect(milk?.totalAmount).toBe(1600);
    // averageRate is rateTotal / rateCount downstream — 160/2 = 80, the true
    // blended rate across the two routes.
    expect(milk?.rateTotal).toBe(160);
    expect(milk?.rateCount).toBe(2);
    // A product delivered on only one of the routes still carries over.
    expect(result.get("cust-1")?.items.get("dahi")?.qty).toBe(2);
  });

  it("does not create a second, empty bill for the non-billing route (the 9 DRAFT duplicates)", () => {
    // Real shape from production: G-2EVNG had the deliveries, G-2MRNG had none,
    // and the customer still ended up with a second all-zero bill.
    const billMap = new Map<string, BillPair>([
      ["cust-1:route-evening", { customerId: "cust-1", routeId: "route-evening", deliveryAmount: 85, items: new Map() }],
    ]);
    const sequenceLines = [
      { customerId: "cust-1", routeId: "route-morning", billsHere: true },
      { customerId: "cust-1", routeId: "route-evening", billsHere: false },
    ];

    const result = buildBillPairs(billMap, sequenceLines);

    expect(result.size).toBe(1);
    expect(result.get("cust-1")?.deliveryAmount).toBe(85);
    expect(result.get("cust-1")?.routeId).toBe("route-morning");
  });

  it("still bills a multi-route customer with no deliveries at all, once", () => {
    const billMap = new Map<string, BillPair>();
    const sequenceLines = [
      { customerId: "cust-1", routeId: "route-morning", billsHere: true },
      { customerId: "cust-1", routeId: "route-evening", billsHere: false },
    ];

    const result = buildBillPairs(billMap, sequenceLines);

    expect(result.size).toBe(1);
    expect(result.get("cust-1")?.deliveryAmount).toBe(0);
    expect(result.get("cust-1")?.routeId).toBe("route-morning");
  });

  it("falls back to a deterministic route when no row is flagged (legacy rows predating the flag)", () => {
    const billMap = new Map<string, BillPair>([
      ["cust-1:route-b", { customerId: "cust-1", routeId: "route-b", deliveryAmount: 200, items: new Map() }],
    ]);
    const sequenceLines = [
      { customerId: "cust-1", routeId: "route-a", billsHere: false },
      { customerId: "cust-1", routeId: "route-b", billsHere: false },
    ];

    const result = buildBillPairs(billMap, sequenceLines);

    // One bill regardless — never two — on the first sequence route.
    expect(result.size).toBe(1);
    expect(result.get("cust-1")?.deliveryAmount).toBe(200);
    expect(result.get("cust-1")?.routeId).toBe("route-a");
  });

  it("keeps separate customers separate", () => {
    const billMap = new Map<string, BillPair>([
      ["cust-1:route-morning", { customerId: "cust-1", routeId: "route-morning", deliveryAmount: 100, items: new Map() }],
      ["cust-2:route-morning", { customerId: "cust-2", routeId: "route-morning", deliveryAmount: 250, items: new Map() }],
    ]);
    const sequenceLines = [
      { customerId: "cust-1", routeId: "route-morning", billsHere: true },
      { customerId: "cust-2", routeId: "route-morning", billsHere: true },
    ];

    const result = buildBillPairs(billMap, sequenceLines);

    expect(result.size).toBe(2);
    expect(result.get("cust-1")?.deliveryAmount).toBe(100);
    expect(result.get("cust-2")?.deliveryAmount).toBe(250);
  });
});

// These back the Customer Summary, which can't be unit tested directly
// (getMonthlyBillSummary calls getCurrentCityId -> cookies(), which throws
// outside a request). Extracting the two decisions that actually changed —
// where a customer bills, and which sequence rows a billing view shows — puts
// them under test and, more importantly, makes generation and the summary
// share one implementation so they can't drift apart.
describe("resolveBillingRoutes", () => {
  it("picks the flagged route", () => {
    const routes = resolveBillingRoutes([
      { customerId: "cust-1", routeId: "route-morning", billsHere: false },
      { customerId: "cust-1", routeId: "route-evening", billsHere: true },
    ]);

    expect(routes.get("cust-1")).toBe("route-evening");
  });

  it("falls back to the earliest row when nothing is flagged (legacy rows)", () => {
    // Input is ordered oldest-first by the caller's query.
    const routes = resolveBillingRoutes([
      { customerId: "cust-1", routeId: "route-a", billsHere: false },
      { customerId: "cust-1", routeId: "route-b", billsHere: false },
    ]);

    expect(routes.get("cust-1")).toBe("route-a");
  });

  it("resolves every customer to exactly one route", () => {
    const routes = resolveBillingRoutes([
      { customerId: "cust-1", routeId: "route-morning", billsHere: true },
      { customerId: "cust-1", routeId: "route-evening", billsHere: false },
      { customerId: "cust-2", routeId: "route-morning", billsHere: false },
      { customerId: "cust-2", routeId: "route-evening", billsHere: false },
      { customerId: "cust-3", routeId: "route-evening", billsHere: true },
    ]);

    expect(routes.size).toBe(3);
    expect(routes.get("cust-1")).toBe("route-morning");
    expect(routes.get("cust-2")).toBe("route-morning"); // fallback
    expect(routes.get("cust-3")).toBe("route-evening");
  });

  it("leaves single-route customers on their only route", () => {
    const routes = resolveBillingRoutes([{ customerId: "cust-1", routeId: "route-1", billsHere: true }]);

    expect(routes.get("cust-1")).toBe("route-1");
  });
});

describe("selectBillingRows", () => {
  const lines = [
    { customerId: "cust-1", routeId: "route-morning", sequenceNo: 1 },
    { customerId: "cust-1", routeId: "route-evening", sequenceNo: 7 },
    { customerId: "cust-2", routeId: "route-morning", sequenceNo: 2 },
  ];

  it("shows a multi-route customer once, under the route that bills them", () => {
    const billingRoutes = new Map([
      ["cust-1", "route-morning"],
      ["cust-2", "route-morning"],
    ]);

    const result = selectBillingRows(lines, billingRoutes);

    expect(result).toHaveLength(2);
    expect(result.filter((line) => line.customerId === "cust-1")).toHaveLength(1);
    expect(result.find((line) => line.customerId === "cust-1")?.routeId).toBe("route-morning");
  });

  it("drops the customer from a route that doesn't bill them, keeping their own sequenceNo elsewhere", () => {
    const billingRoutes = new Map([
      ["cust-1", "route-evening"],
      ["cust-2", "route-morning"],
    ]);

    const result = selectBillingRows(lines, billingRoutes);

    const custOne = result.find((line) => line.customerId === "cust-1");
    expect(custOne?.routeId).toBe("route-evening");
    // Keeps that route's own sequence number, not the other route's.
    expect(custOne?.sequenceNo).toBe(7);
    expect(result).toHaveLength(2);
  });

  it("viewing only the non-billing route yields no row for that customer", () => {
    const eveningOnly = lines.filter((line) => line.routeId === "route-evening");
    const billingRoutes = new Map([["cust-1", "route-morning"]]);

    expect(selectBillingRows(eveningOnly, billingRoutes)).toHaveLength(0);
  });

  it("leaves a single-route view completely unchanged", () => {
    const singleRoute = [
      { customerId: "cust-1", routeId: "route-1", sequenceNo: 1 },
      { customerId: "cust-2", routeId: "route-1", sequenceNo: 2 },
    ];
    const billingRoutes = new Map([
      ["cust-1", "route-1"],
      ["cust-2", "route-1"],
    ]);

    expect(selectBillingRows(singleRoute, billingRoutes)).toEqual(singleRoute);
  });
});

// A customer on a morning AND an evening route can be delivered twice on the
// same date, but the printed bill has one row per date. Both calendar callers
// built their day map with a plain set/Map(...), so the second route's line
// silently replaced the first and the grid stopped adding up to the bill total
// printed beside it.
describe("mergeCalendarDays", () => {
  it("sums the same product delivered on two routes on one day", () => {
    const merged = mergeCalendarDays([
      { skipped: false, entries: [{ productId: "milk", quantity: 2, rateSnapshot: 85 }] },
      { skipped: false, entries: [{ productId: "milk", quantity: 3, rateSnapshot: 85 }] },
    ]);

    expect(merged.entries).toHaveLength(1);
    expect(merged.entries[0].quantity).toBe(5);
    expect(merged.entries[0].rateSnapshot).toBe(85);
    // quantity x rate must still equal the real amount: 2*85 + 3*85 = 425.
    expect(merged.entries[0].quantity * merged.entries[0].rateSnapshot).toBe(425);
  });

  it("blends differing rates so quantity x rate still equals the true amount", () => {
    const merged = mergeCalendarDays([
      { skipped: false, entries: [{ productId: "milk", quantity: 2, rateSnapshot: 80 }] },
      { skipped: false, entries: [{ productId: "milk", quantity: 2, rateSnapshot: 90 }] },
    ]);

    const cell = merged.entries[0];
    expect(cell.quantity).toBe(4);
    expect(cell.rateSnapshot).toBe(85);
    expect(cell.quantity * cell.rateSnapshot).toBe(340); // 160 + 180
  });

  it("keeps products that appear on only one of the routes", () => {
    const merged = mergeCalendarDays([
      { skipped: false, entries: [{ productId: "milk", quantity: 1, rateSnapshot: 85 }] },
      { skipped: false, entries: [{ productId: "dahi", quantity: 2, rateSnapshot: 60 }] },
    ]);

    expect(merged.entries).toHaveLength(2);
    expect(merged.entries.find((entry) => entry.productId === "dahi")?.quantity).toBe(2);
  });

  it("counts a day as skipped only when every route skipped it", () => {
    expect(mergeCalendarDays([
      { skipped: true, entries: [] },
      { skipped: true, entries: [] },
    ]).skipped).toBe(true);

    // Delivered on one route, skipped on the other — the day is NOT a skip.
    expect(mergeCalendarDays([
      { skipped: true, entries: [] },
      { skipped: false, entries: [{ productId: "milk", quantity: 1, rateSnapshot: 85 }] },
    ]).skipped).toBe(false);
  });

  it("leaves a single-route day exactly as it was", () => {
    const merged = mergeCalendarDays([
      { skipped: false, entries: [{ productId: "milk", quantity: 2, rateSnapshot: 85 }] },
    ]);

    expect(merged).toEqual({
      skipped: false,
      entries: [{ productId: "milk", quantity: 2, rateSnapshot: 85 }],
    });
  });

  it("yields a 0 rate rather than NaN for a recorded but empty line", () => {
    const merged = mergeCalendarDays([
      { skipped: false, entries: [{ productId: "milk", quantity: 0, rateSnapshot: 85 }] },
    ]);

    expect(merged.entries[0].rateSnapshot).toBe(0);
    expect(Number.isNaN(merged.entries[0].rateSnapshot)).toBe(false);
  });
});

// Nothing forces a customer to HAVE a flagged row: the partial unique index
// only forbids a second one. Both rows can end up false — a mistake, a legacy
// row, or a removal that took the flagged one away. These pin down what
// happens then, because the answer has to be identical in bill generation and
// in the Customer Summary or a customer gets billed on two different routes
// depending on which screen you look at.
describe("resolveBillingRoutes — when no route is flagged", () => {
  it("bills on the earliest row, so the customer still gets exactly one bill", () => {
    const routes = resolveBillingRoutes([
      { customerId: "cust-1", routeId: "route-added-first", billsHere: false },
      { customerId: "cust-1", routeId: "route-added-second", billsHere: false },
    ]);

    expect(routes.size).toBe(1);
    expect(routes.get("cust-1")).toBe("route-added-first");
  });

  it("gives the same answer whichever screen asks, as long as rows are oldest-first", () => {
    const rows = [
      { customerId: "cust-1", routeId: "route-added-first", billsHere: false },
      { customerId: "cust-1", routeId: "route-added-second", billsHere: false },
    ];

    // Bill generation and the summary run this over the same ordered rows.
    expect(resolveBillingRoutes(rows).get("cust-1")).toBe(resolveBillingRoutes([...rows]).get("cust-1"));
  });

  it("is order-sensitive by design — callers MUST order oldest-first", () => {
    // Documents the contract rather than hiding it: reversed input gives the
    // other route, which is exactly why both queries carry orderBy createdAt.
    const reversed = resolveBillingRoutes([
      { customerId: "cust-1", routeId: "route-added-second", billsHere: false },
      { customerId: "cust-1", routeId: "route-added-first", billsHere: false },
    ]);

    expect(reversed.get("cust-1")).toBe("route-added-second");
  });

  it("a single flagged row still wins over the earliest unflagged one", () => {
    const routes = resolveBillingRoutes([
      { customerId: "cust-1", routeId: "route-added-first", billsHere: false },
      { customerId: "cust-1", routeId: "route-added-second", billsHere: true },
    ]);

    expect(routes.get("cust-1")).toBe("route-added-second");
  });
});

describe("selectStaleDuplicateBills", () => {
  it("selects the bill left behind on a route that no longer bills the customer", () => {
    const stale = selectStaleDuplicateBills(
      [
        { id: "bill-morning", customerId: "cust-1", routeId: "route-morning" },
        { id: "bill-evening", customerId: "cust-1", routeId: "route-evening" },
      ],
      new Map([["cust-1", "route-morning"]]),
    );

    expect(stale).toEqual(["bill-evening"]);
  });

  it("keeps the bill on the current billing route", () => {
    const stale = selectStaleDuplicateBills(
      [{ id: "bill-morning", customerId: "cust-1", routeId: "route-morning" }],
      new Map([["cust-1", "route-morning"]]),
    );

    expect(stale).toEqual([]);
  });

  it("never touches a customer this run knows nothing about", () => {
    const stale = selectStaleDuplicateBills(
      [{ id: "bill-other", customerId: "cust-unknown", routeId: "route-x" }],
      new Map([["cust-1", "route-morning"]]),
    );

    expect(stale).toEqual([]);
  });

  it("handles several customers independently", () => {
    const stale = selectStaleDuplicateBills(
      [
        { id: "a-keep", customerId: "cust-1", routeId: "route-morning" },
        { id: "a-drop", customerId: "cust-1", routeId: "route-evening" },
        { id: "b-keep", customerId: "cust-2", routeId: "route-evening" },
        { id: "b-drop", customerId: "cust-2", routeId: "route-morning" },
      ],
      new Map([
        ["cust-1", "route-morning"],
        ["cust-2", "route-evening"],
      ]),
    );

    expect(stale.sort()).toEqual(["a-drop", "b-drop"]);
  });
});

// Removing a customer from a route's sequence mid-month does NOT delete the
// daily entries already recorded on that route — the removal action only drops
// the sequence row. So those deliveries still have to be billed, or the
// business silently loses the money for milk it actually handed over.
describe("buildBillPairs — customer removed from a route mid-month", () => {
  it("still bills deliveries from the route they were removed from, on the route they remain on", () => {
    const billMap = new Map<string, BillPair>([
      // Entries recorded on the morning route BEFORE they were removed from it.
      ["cust-1:route-morning", { customerId: "cust-1", routeId: "route-morning", deliveryAmount: 400, items: new Map() }],
      ["cust-1:route-evening", { customerId: "cust-1", routeId: "route-evening", deliveryAmount: 600, items: new Map() }],
    ]);
    // Only the evening row survives — the morning sequence row was removed.
    const sequenceLines = [{ customerId: "cust-1", routeId: "route-evening", billsHere: true }];

    const result = buildBillPairs(billMap, sequenceLines);

    expect(result.size).toBe(1);
    expect(result.get("cust-1")?.routeId).toBe("route-evening");
    // The 400 from the removed route is NOT dropped.
    expect(result.get("cust-1")?.deliveryAmount).toBe(1000);
  });

  it("still bills a customer removed from every route, on the route the deliveries happened on", () => {
    const billMap = new Map<string, BillPair>([
      ["cust-1:route-morning", { customerId: "cust-1", routeId: "route-morning", deliveryAmount: 250, items: new Map() }],
    ]);

    const result = buildBillPairs(billMap, []);

    expect(result.get("cust-1")?.deliveryAmount).toBe(250);
    expect(result.get("cust-1")?.routeId).toBe("route-morning");
  });
});

// A customer billed in July with money still owed, who isn't on any route in
// August: no deliveries and no sequence row, so nothing puts them in an August
// bill run at all.
describe("buildBillPairs — customer gone from every route the following month", () => {
  it("produces no bill when they have neither deliveries nor a sequence row", () => {
    const result = buildBillPairs(new Map<string, BillPair>(), []);

    expect(result.size).toBe(0);
  });
});
