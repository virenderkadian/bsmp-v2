import { describe, expect, it } from "vitest";
import {
  summariseCashReport,
  type CashReportDay, computeLeftover, computeLeftoverValue, computeVehicleBalance
} from "@/lib/reconciliation-math";

describe("computeLeftover", () => {
  it("matches the business's own worked example (100 given, 40 evening, 50 morning, 2 returned -> 8)", () => {
    expect(
      computeLeftover({ given: 100, eveningDelivered: 40, morningDelivered: 50, returned: 2 }),
    ).toBe(8);
  });

  it("goes negative when more was delivered/returned than given (a real shortage)", () => {
    expect(
      computeLeftover({ given: 50, eveningDelivered: 30, morningDelivered: 25, returned: 0 }),
    ).toBe(-5);
  });

  it("is zero when nothing was given or moved", () => {
    expect(
      computeLeftover({ given: 0, eveningDelivered: 0, morningDelivered: 0, returned: 0 }),
    ).toBe(0);
  });
});

describe("computeLeftoverValue", () => {
  it("values the leftover at the product's rate", () => {
    expect(computeLeftoverValue(8, 85)).toBe(680);
  });

  it("stays negative (a shortage has a negative value, not an absolute one)", () => {
    expect(computeLeftoverValue(-5, 60)).toBe(-300);
  });
});

describe("computeVehicleBalance", () => {
  it("subtracts payments received from the cash sale total", () => {
    expect(computeVehicleBalance(680, 500)).toBe(180);
  });

  it("goes negative when payments exceed the cash sale total (vehicle is in credit)", () => {
    expect(computeVehicleBalance(200, 500)).toBe(-300);
  });
});

describe("summariseCashReport", () => {
  const day = (overrides: Partial<CashReportDay> = {}): CashReportDay => ({
    date: "2026-08-01",
    stockRecorded: true,
    deposited: 0,
    products: [{ productId: "buffalo", given: 170, delivered: 122.5, returned: 11.5, rate: 85 }],
    ...overrides,
  });

  it("closes the milk balance: taken = distributed + returned + cash", () => {
    const totals = summariseCashReport([day()]);
    const product = totals.products[0];

    expect(product.distributed + product.returned + product.cashQty).toBe(product.taken);
    expect(product.cashQty).toBe(36);
    expect(product.cashAmount).toBe(3060);
  });

  it("nets deposits off the cash to give what the driver owes", () => {
    const totals = summariseCashReport([day({ deposited: 85 })]);

    expect(totals.totalCash).toBe(3060);
    expect(totals.totalDeposited).toBe(85);
    expect(totals.owed).toBe(2975);
  });

  it("adds up across days and products", () => {
    const totals = summariseCashReport([
      day({ deposited: 85 }),
      day({
        date: "2026-08-02",
        deposited: 43,
        products: [
          { productId: "buffalo", given: 170, delivered: 117.5, returned: 17.2, rate: 85 },
          { productId: "cow", given: 40, delivered: 31, returned: 6, rate: 75 },
        ],
      }),
    ]);

    expect(totals.products).toHaveLength(2);
    expect(totals.totalDeposited).toBe(128);
  });

  it("leaves a day with no stock out of the cash, but still counts its deposit", () => {
    // Stock entry is being migrated vehicle by vehicle. Counting an unrecorded
    // day would compute leftover as 0 - delivered, dragging the amount owed far
    // below the truth — but the money handed over that day was still handed over.
    const totals = summariseCashReport([
      day({ deposited: 85 }),
      day({ date: "2026-08-02", stockRecorded: false, deposited: 500, products: [] }),
    ]);

    expect(totals.totalCash).toBe(3060);
    expect(totals.totalDeposited).toBe(585);
    expect(totals.daysRecorded).toBe(1);
    expect(totals.daysMissingStock).toBe(1);
  });

  it("keeps a negative leftover exactly as it falls", () => {
    // More delivered than loaded. Left alone by decision: it reduces what the
    // driver owes, and the entry practice behind it is the thing to fix.
    const totals = summariseCashReport([
      day({ products: [{ productId: "lassi", given: 10, delivered: 11, returned: 0, rate: 30 }] }),
    ]);

    expect(totals.products[0].cashQty).toBe(-1);
    expect(totals.totalCash).toBe(-30);
  });

  it("reports nothing rather than zero when no day has stock", () => {
    const totals = summariseCashReport([day({ stockRecorded: false, products: [] })]);

    expect(totals.products).toEqual([]);
    expect(totals.daysRecorded).toBe(0);
  });
});
