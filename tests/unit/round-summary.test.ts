import { describe, expect, it } from "vitest";
import type { DriverSheetCustomer, DriverSheetProduct } from "@/lib/driver-api-types";
import { summariseRound, summariseRoundCashSales } from "../../mobile/src/round-summary";
import { productLabel, productShortLabel } from "../../mobile/src/product-label";

// Real Rohtak product shapes: the code AND the shortName are both a single
// letter there, which is what made the app render a column of bare letters.
const BUFFALO: DriverSheetProduct = {
  productId: "p-buffalo",
  code: "B",
  name: "Buffalo Milk",
  shortName: "B",
  unit: "Litre",
  rate: "70",
  defaultQty: "2",
  deliveredQty: "2",
};

const LASSI: DriverSheetProduct = {
  productId: "p-lassi",
  code: "L",
  name: "Lassi",
  shortName: null,
  unit: "Litre",
  rate: "60",
  defaultQty: "0",
  deliveredQty: "0",
};

function customer(overrides: Partial<DriverSheetCustomer> = {}): DriverSheetCustomer {
  return {
    customerId: "c-1",
    customerCode: "cus01",
    sequenceNo: 1,
    name: "A Customer",
    area: null,
    mobile: null,
    products: [BUFFALO, LASSI],
    skipped: false,
    remarks: null,
    saved: true,
    latitude: null,
    longitude: null,
    previousBill: null,
    ...overrides,
  };
}

describe("summariseRound", () => {
  it("totals what was actually delivered", () => {
    const summary = summariseRound([
      customer({ customerId: "c-1", products: [{ ...BUFFALO, deliveredQty: "2" }] }),
      customer({ customerId: "c-2", products: [{ ...BUFFALO, deliveredQty: "1.5" }] }),
    ]);

    expect(summary.delivered).toBe(2);
    expect(summary.products).toEqual([
      { productId: "p-buffalo", label: "Buffalo Milk", qty: 3.5, unit: "Litre" },
    ]);
  });

  it("ignores a customer who was never visited, even though they carry a prefill", () => {
    // The bug. An unsaved customer's deliveredQty is their usual order, which
    // is a suggestion for the delivery card — counting it here overstated the
    // round against what the web had recorded.
    const summary = summariseRound([
      customer({ customerId: "c-1", saved: true, products: [{ ...BUFFALO, deliveredQty: "2" }] }),
      customer({ customerId: "c-2", saved: false, products: [{ ...BUFFALO, deliveredQty: "3" }] }),
    ]);

    expect(summary.delivered).toBe(1);
    expect(summary.notVisited).toBe(1);
    expect(summary.products[0].qty).toBe(2);
  });

  it("counts nothing at all when a round has only prefilled, unvisited stops", () => {
    const summary = summariseRound([
      customer({ saved: false, products: [{ ...BUFFALO, deliveredQty: "2" }] }),
    ]);

    expect(summary.delivered).toBe(0);
    expect(summary.products).toEqual([]);
  });

  it("excludes a skipped stop but still reports it as skipped", () => {
    const summary = summariseRound([
      customer({ customerId: "c-1", saved: true, skipped: true, products: [{ ...BUFFALO, deliveredQty: "2" }] }),
      customer({ customerId: "c-2", saved: true, products: [{ ...BUFFALO, deliveredQty: "1" }] }),
    ]);

    expect(summary.skipped).toBe(1);
    expect(summary.delivered).toBe(1);
    expect(summary.products[0].qty).toBe(1);
  });

  it("labels by full name, never by the code letter", () => {
    const summary = summariseRound([customer({ products: [{ ...BUFFALO, deliveredQty: "1" }] })]);

    expect(summary.products[0].label).toBe("Buffalo Milk");
    expect(summary.products[0].label).not.toBe("B");
  });

  it("keeps one product on one row even when the label changes mid-round", () => {
    const summary = summariseRound([
      customer({ customerId: "c-1", products: [{ ...BUFFALO, deliveredQty: "1" }] }),
      customer({ customerId: "c-2", products: [{ ...BUFFALO, name: "Buffalo Milk (Full)", deliveredQty: "1" }] }),
    ]);

    expect(summary.products).toHaveLength(1);
    expect(summary.products[0].qty).toBe(2);
  });

  it("drops zero-quantity products rather than listing them at 0", () => {
    const summary = summariseRound([customer({ products: [BUFFALO, LASSI] })]);

    expect(summary.products.map((entry) => entry.productId)).toEqual(["p-buffalo"]);
  });
});

describe("summariseRoundCashSales", () => {
  const sale = (items: Array<{ productId: string; code: string; name?: string; quantity: number; amount: number }>) => ({
    id: `s-${items[0].productId}-${items[0].quantity}`,
    routeId: "r-1",
    sessionDate: "2026-08-19",
    createdAt: "2026-08-19T06:45:00.000Z",
    items: items.map((item) => ({ ...item, unit: "Litre", rate: 70 })),
    totalAmount: items.reduce((sum, item) => sum + item.amount, 0),
  });

  it("adds up quantity and money across sales in the round", () => {
    const summary = summariseRoundCashSales([
      sale([{ productId: "p-buffalo", code: "B", name: "Buffalo Milk", quantity: 2, amount: 140 }]),
      sale([{ productId: "p-buffalo", code: "B", name: "Buffalo Milk", quantity: 1, amount: 70 }]),
    ]);

    expect(summary.totalAmount).toBe(210);
    expect(summary.products).toEqual([
      { productId: "p-buffalo", label: "Buffalo Milk", qty: 3, unit: "Litre" },
    ]);
  });

  it("falls back to the code for a sale recorded before names were stored", () => {
    // Entries already on drivers' phones have no name field.
    const summary = summariseRoundCashSales([
      sale([{ productId: "p-buffalo", code: "B", quantity: 1, amount: 70 }]),
    ]);

    expect(summary.products[0].label).toBe("B");
  });
});

describe("productLabel", () => {
  it("prefers the full name over a single-letter shortName", () => {
    expect(productLabel(BUFFALO)).toBe("Buffalo Milk");
  });

  it("never returns the bare code when a name exists", () => {
    expect(productLabel({ code: "A", name: "BUFFALO MILK", shortName: null })).toBe("BUFFALO MILK");
  });

  it("treats a blank name as absent rather than rendering an empty label", () => {
    expect(productLabel({ code: "A", name: "   ", shortName: null })).toBe("A");
  });

  it("keeps the operator's abbreviation in the compact form", () => {
    expect(productShortLabel({ code: "A", name: "BUFFALO MILK", shortName: "B MILK" })).toBe("B MILK");
  });

  it("falls back to the name, not the code, when there is no shortName", () => {
    expect(productShortLabel(LASSI)).toBe("Lassi");
  });
});
