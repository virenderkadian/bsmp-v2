import { describe, expect, it } from "vitest";
import { computeLeftover, computeLeftoverValue, computeVehicleBalance } from "@/lib/reconciliation-math";

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
