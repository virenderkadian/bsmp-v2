import { describe, expect, it } from "vitest";
import { isUnsettled } from "@/lib/vehicle-balance";

describe("isUnsettled", () => {
  it("is false for a zero or rounding-sized balance", () => {
    expect(isUnsettled({ balance: "0.00" })).toBe(false);
    expect(isUnsettled({ balance: "0.004" })).toBe(false);
    expect(isUnsettled({ balance: "-0.004" })).toBe(false);
  });
  it("is true for cash not handed in and for an overpayment", () => {
    expect(isUnsettled({ balance: "120.50" })).toBe(true);
    expect(isUnsettled({ balance: "-30.00" })).toBe(true);
  });
});
