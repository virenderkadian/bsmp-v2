import { describe, expect, it } from "vitest";
import { ABSENT_SIGNATURE, deliverySignature } from "@/lib/daily-entry-diff";

describe("deliverySignature", () => {
  it("collapses skipped, empty, and all-zero deliveries to the same absent value", () => {
    const skipped = deliverySignature(true, [{ productId: "p1", quantity: 5, rateSnapshot: 50 }]);
    const empty = deliverySignature(false, []);
    const allZero = deliverySignature(false, [{ productId: "p1", quantity: 0, rateSnapshot: 50 }]);

    expect(skipped).toBe(ABSENT_SIGNATURE);
    expect(empty).toBe(ABSENT_SIGNATURE);
    expect(allZero).toBe(ABSENT_SIGNATURE);
  });

  it("is stable regardless of product order", () => {
    const a = deliverySignature(false, [
      { productId: "p1", quantity: 2, rateSnapshot: 50 },
      { productId: "p2", quantity: 1, rateSnapshot: 30 },
    ]);
    const b = deliverySignature(false, [
      { productId: "p2", quantity: 1, rateSnapshot: 30 },
      { productId: "p1", quantity: 2, rateSnapshot: 50 },
    ]);

    expect(a).toBe(b);
  });

  it("treats a value-identical rewrite as unchanged", () => {
    const stored = deliverySignature(false, [{ productId: "p1", quantity: 3, rateSnapshot: 50 }]);
    const resubmitted = deliverySignature(false, [{ productId: "p1", quantity: 3, rateSnapshot: 50 }]);

    expect(stored).toBe(resubmitted);
  });

  it("detects a quantity change", () => {
    const before = deliverySignature(false, [{ productId: "p1", quantity: 3, rateSnapshot: 50 }]);
    const after = deliverySignature(false, [{ productId: "p1", quantity: 4, rateSnapshot: 50 }]);

    expect(before).not.toBe(after);
  });

  it("detects a rate change even when quantity is unchanged", () => {
    const before = deliverySignature(false, [{ productId: "p1", quantity: 3, rateSnapshot: 50 }]);
    const after = deliverySignature(false, [{ productId: "p1", quantity: 3, rateSnapshot: 55 }]);

    expect(before).not.toBe(after);
  });

  it("detects a dropped product (delivery removed)", () => {
    const before = deliverySignature(false, [
      { productId: "p1", quantity: 3, rateSnapshot: 50 },
      { productId: "p2", quantity: 1, rateSnapshot: 30 },
    ]);
    const after = deliverySignature(false, [{ productId: "p1", quantity: 3, rateSnapshot: 50 }]);

    expect(before).not.toBe(after);
  });

  it("detects newly adding a delivery to a previously-absent customer", () => {
    const before = deliverySignature(false, []);
    const after = deliverySignature(false, [{ productId: "p1", quantity: 3, rateSnapshot: 50 }]);

    expect(before).toBe(ABSENT_SIGNATURE);
    expect(after).not.toBe(before);
  });
});
