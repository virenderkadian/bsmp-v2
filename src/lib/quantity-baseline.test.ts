import { describe, expect, it } from "vitest";
import { computeModeQuantity, computeQuantityBand, isQuantityUnusual } from "@/lib/quantity-baseline";

describe("computeQuantityBand", () => {
  it("needs at least 3 prior deliveries before saying anything", () => {
    expect(computeQuantityBand([])).toBeNull();
    expect(computeQuantityBand([2])).toBeNull();
    expect(computeQuantityBand([2, 2])).toBeNull();
    expect(computeQuantityBand([2, 2, 2])).not.toBeNull();
  });

  it("uses the median, not the average — one loud outlier doesn't move it", () => {
    // A single 20L day among a run of 1.5L days should barely register.
    const band = computeQuantityBand([1.5, 1.5, 1.5, 1.5, 20]);
    expect(band?.median).toBe(1.5);
  });

  it("bands at 2x either side of the median for a baseline large enough that the floor doesn't bind", () => {
    const band = computeQuantityBand([6, 6, 6, 6]);
    expect(band).toEqual({ median: 6, min: 3, max: 12 });
  });

  it("widens to a flat +/-2 for a small baseline, where 2x alone would be too tight", () => {
    // Median 1: 2x gives [0.5, 2], but the +/-2 floor is wider on both ends.
    const band = computeQuantityBand([1, 1, 1, 1]);
    expect(band).toEqual({ median: 1, min: 0, max: 3 });
  });

  it("never returns a negative lower bound", () => {
    const band = computeQuantityBand([0.5, 0.5, 0.5]);
    expect(band?.min).toBe(0);
  });

  it("says nothing when the customer's own baseline is zero", () => {
    // Nothing to be a multiple of zero — a band here would flag every real delivery.
    expect(computeQuantityBand([0, 0, 0])).toBeNull();
  });

  it("the institution pattern: a mixed history still centres on the true baseline", () => {
    // SANGWAN ACADEMY's real shape — mostly 10-20L, occasional 1L days.
    // Median has to land near the big-day baseline, not get pulled to the middle.
    const band = computeQuantityBand([18, 1, 15, 12, 18, 10, 1, 20, 1, 15, 12, 18, 12, 1]);
    expect(band?.median).toBeGreaterThanOrEqual(11);
  });
});

describe("computeModeQuantity", () => {
  it("needs at least 3 prior deliveries before saying anything", () => {
    expect(computeModeQuantity([2, 2])).toBeNull();
    expect(computeModeQuantity([2, 2, 2])).toBe(2);
  });

  it("picks the value that actually repeats — real number the customer has ordered, not a synthetic middle", () => {
    // SAJAIN SINGH's real shape: alternates 1L/3L. Median would say "2", a
    // quantity they've never once taken. Mode says a real one.
    expect(computeModeQuantity([1, 1, 1, 1, 1, 3, 3, 3, 3])).toBe(1);
  });

  it("on a tie, returns whichever hit the top count first — any answer is reasonable", () => {
    const result = computeModeQuantity([1, 1, 3, 3]);
    expect([1, 3]).toContain(result);
  });
});

describe("isQuantityUnusual", () => {
  it("never flags with no band", () => {
    expect(isQuantityUnusual(50, null)).toBe(false);
  });

  it("never flags a zero or blank cell — nothing typed is not a typo", () => {
    const band = computeQuantityBand([2, 2, 2]);
    expect(isQuantityUnusual(0, band)).toBe(false);
  });

  it("stays quiet inside the band", () => {
    const band = computeQuantityBand([6, 6, 6, 6]); // min 3, max 12
    expect(isQuantityUnusual(4, band)).toBe(false);
    expect(isQuantityUnusual(6, band)).toBe(false);
    expect(isQuantityUnusual(11.9, band)).toBe(false);
  });

  it("flags a value the real data says is genuinely rare — the missing-decimal shape", () => {
    const band = computeQuantityBand([2, 2, 2, 2]); // min 0, max 4 (floor-widened)
    expect(isQuantityUnusual(20, band)).toBe(true);
  });

  it("flags a drop just as readily as a spike", () => {
    const band = computeQuantityBand([6, 6, 6, 6]); // min 3
    expect(isQuantityUnusual(1, band)).toBe(true);
  });

  it("the institution's real low day (1L against a ~12-15L baseline) reads as unusual, not the big days", () => {
    const band = computeQuantityBand([18, 1, 15, 12, 18, 10, 1, 20, 1, 15, 12, 18, 12, 1]);
    expect(isQuantityUnusual(1, band)).toBe(true);
    expect(isQuantityUnusual(18, band)).toBe(false);
    expect(isQuantityUnusual(20, band)).toBe(false);
  });

  it("never flags a quantity this customer has genuinely ordered recently, even outside the band", () => {
    // SAJAIN SINGH's real history: steady alternation between 1L and 3L.
    // Median lands at 2, so a plain band could treat one side as the outlier —
    // the exact-match exemption keeps both sides clear regardless.
    const history = [1, 1, 1, 1, 1, 3, 3, 3, 3, 3];
    const band = computeQuantityBand(history);
    expect(isQuantityUnusual(1, band, history)).toBe(false);
    expect(isQuantityUnusual(3, band, history)).toBe(false);
    // A value they've never taken, well outside the band, still flags.
    expect(isQuantityUnusual(20, band, history)).toBe(true);
  });
});
