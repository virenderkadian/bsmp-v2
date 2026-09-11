import { describe, expect, it } from "vitest";
import {
  narrowSummaryToSoldProducts,
  soldProductIds,
  otherItemsFor,
  splitDailyAndOccasional,
  type ClassifiedProduct,
} from "@/lib/sold-products";

// Milk is on the grid every morning; ghee is an occasional sale.
const BUFFALO: ClassifiedProduct = { id: "buf", code: "BUF", name: "Buffalo Milk", shortName: "BUF", unit: "L", showInDailyEntry: true };
const COW: ClassifiedProduct = { id: "cow", code: "COW", name: "Cow Milk", shortName: "COW", unit: "L", showInDailyEntry: true };
const DAHI: ClassifiedProduct = { id: "dahi", code: "DAHI", name: "Dahi", shortName: "DAHI", unit: "kg", showInDailyEntry: true };
const GHEE: ClassifiedProduct = { id: "ghee", code: "GHEE", name: "Ghee", shortName: "GHEE", unit: "kg", showInDailyEntry: false };
const CATALOGUE = [BUFFALO, COW, DAHI, GHEE];

function row(quantities: Record<string, string>, money: Partial<Record<string, string>> = {}) {
  return {
    productQuantities: {
      buf: "0.000",
      cow: "0.000",
      dahi: "0.000",
      ghee: "0.000",
      ...quantities,
    },
    deliveryAmount: money.deliveryAmount ?? "0.00",
    openingBalance: money.openingBalance ?? "0.00",
    paymentAmount: money.paymentAmount ?? "0.00",
    pendingAmount: money.pendingAmount ?? "0.00",
  };
}

const emptyTotals = {
  productQuantities: {},
  deliveryAmount: "0.00",
  openingBalance: "0.00",
  paymentAmount: "0.00",
  pendingAmount: "0.00",
};

function payload(rows: ReturnType<typeof row>[]) {
  return {
    products: CATALOGUE,
    routes: [{ id: "r1", rows, totals: emptyTotals }],
    grandTotals: emptyTotals,
  };
}

describe("soldProductIds", () => {
  it("counts a product only where a quantity actually moved", () => {
    expect([...soldProductIds([row({ buf: "2.000" })])]).toEqual(["buf"]);
  });

  it("does not resurrect a column from an explicit zero", () => {
    // Daily Entry keeps a deliberate 0 as a real correction. That records
    // "nothing delivered", which is not a reason to print a column.
    expect(soldProductIds([row({ buf: "0.000", cow: "0.000" })]).size).toBe(0);
  });

  it("takes the union across rows", () => {
    const ids = soldProductIds([row({ buf: "1.000" }), row({ ghee: "0.500" })]);
    expect([...ids].sort()).toEqual(["buf", "ghee"]);
  });
});

describe("narrowSummaryToSoldProducts", () => {
  it("prints two columns for a milk-only round, not the whole catalogue", () => {
    // The reported problem: eleven columns on A4 for a round that sells milk.
    const result = narrowSummaryToSoldProducts(
      payload([row({ buf: "60.000" }), row({ buf: "31.000", cow: "15.000" })]),
    );

    expect(result.products.map((product) => product.code)).toEqual(["BUF", "COW"]);
    expect(Object.keys(result.routes[0].rows[0].productQuantities).sort()).toEqual(["buf", "cow"]);
  });

  it("keeps an occasional sale out of the columns but inside the money", () => {
    // The office sheet does not need a ghee column for one sale among sixty
    // rows. The amount is already inside every Amount and total; the
    // customer's own bill is where it gets itemised.
    const result = narrowSummaryToSoldProducts(
      payload([
        row({ buf: "60.000" }, { deliveryAmount: "5100.00" }),
        row({ buf: "31.000", ghee: "0.500" }, { deliveryAmount: "3360.00" }),
      ]),
    );

    expect(result.products.map((product) => product.code)).toEqual(["BUF"]);
    // The ghee money is untouched — only its column is gone.
    expect(result.grandTotals.deliveryAmount).toBe("8460.00");
  });

  it("shows the occasional columns when Configuration asks for them", () => {
    const result = narrowSummaryToSoldProducts(
      payload([row({ buf: "60.000" }), row({ buf: "31.000", ghee: "0.500" })]),
      true,
    );

    expect(result.products.map((product) => product.code)).toEqual(["BUF", "GHEE"]);
  });

  it("recomputes the totals over the columns that survived", () => {
    const result = narrowSummaryToSoldProducts(
      payload([
        row({ buf: "10.500" }, { deliveryAmount: "1000.00", pendingAmount: "700.00" }),
        row({ buf: "4.250" }, { deliveryAmount: "425.50", pendingAmount: "425.50" }),
      ]),
    );

    expect(result.routes[0].totals.productQuantities).toEqual({ buf: "14.750" });
    expect(result.routes[0].totals.deliveryAmount).toBe("1425.50");
    expect(result.grandTotals.pendingAmount).toBe("1125.50");
    // No stale column left behind in the totals row.
    expect(Object.keys(result.grandTotals.productQuantities)).toEqual(["buf"]);
  });

  it("leaves the catalogue alone when nothing has been sold yet", () => {
    // An empty month should still have the shape of a sheet rather than
    // collapsing to a table with no product columns at all.
    const result = narrowSummaryToSoldProducts(payload([row({})]));
    expect(result.products).toHaveLength(4);
  });
});

describe("splitDailyAndOccasional", () => {
  it("separates the grid products from the occasional ones", () => {
    const { daily, occasional } = splitDailyAndOccasional(CATALOGUE);
    expect(daily.map((p) => p.code)).toEqual(["BUF", "COW", "DAHI"]);
    expect(occasional.map((p) => p.code)).toEqual(["GHEE"]);
  });
});

describe("otherItemsFor", () => {
  const { occasional } = splitDailyAndOccasional(CATALOGUE);

  it("summarises occasional sales at the rate actually charged", () => {
    // 0.5 kg of ghee at a rate typed at the door, not the catalogue rate.
    const result = otherItemsFor(occasional, [
      { productId: "buf", totalQty: "62", averageRate: "85", totalAmount: "5270" },
      { productId: "ghee", totalQty: "0.5", averageRate: "1450", totalAmount: "725" },
    ]);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ name: "Ghee", quantity: "0.500", rate: "1450.00", amount: "725.00" });
    // Milk is not an occasional item and must not be double-counted here.
    expect(result.total).toBe("725.00");
  });

  it("prints nothing when the month had no occasional sales", () => {
    const result = otherItemsFor(occasional, [
      { productId: "buf", totalQty: "62", averageRate: "85", totalAmount: "5270" },
    ]);
    expect(result.lines).toEqual([]);
    expect(result.total).toBe("0.00");
  });

  it("skips a zero-quantity correction rather than printing it as a sale", () => {
    const result = otherItemsFor(occasional, [
      { productId: "ghee", totalQty: "0", averageRate: "1450", totalAmount: "0" },
    ]);
    expect(result.lines).toEqual([]);
  });
});
