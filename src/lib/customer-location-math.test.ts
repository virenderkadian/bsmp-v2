import { describe, expect, it } from "vitest";
import {
  findLocationOutliers,
  haversineKm,
  isPlausibleCoordinate,
  routeCentre,
} from "@/lib/customer-location-math";

// Real Bahadurgarh coordinates from production, so the distances below are
// meaningful rather than invented.
const NEARBY = [
  { customerId: "a", latitude: 28.690394, longitude: 76.911351 },
  { customerId: "b", latitude: 28.696613, longitude: 76.911818 },
  { customerId: "c", latitude: 28.695904, longitude: 76.907831 },
  { customerId: "d", latitude: 28.6912, longitude: 76.9105 },
  { customerId: "e", latitude: 28.6939, longitude: 76.9098 },
];

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    expect(haversineKm(28.69, 76.91, 28.69, 76.91)).toBe(0);
  });

  it("measures a short street-level distance in hundreds of metres", () => {
    const km = haversineKm(28.690394, 76.911351, 28.696613, 76.911818);
    expect(km).toBeGreaterThan(0.6);
    expect(km).toBeLessThan(0.8);
  });
});

describe("routeCentre", () => {
  it("returns null with nothing to centre", () => {
    expect(routeCentre([])).toBeNull();
  });

  it("lands inside the cluster", () => {
    const centre = routeCentre(NEARBY)!;
    expect(centre.latitude).toBeGreaterThan(28.68);
    expect(centre.latitude).toBeLessThan(28.70);
    expect(centre.longitude).toBeGreaterThan(76.90);
    expect(centre.longitude).toBeLessThan(76.92);
  });

  it("is not dragged by an extreme point, unlike a mean", () => {
    const withOutlier = [...NEARBY, { customerId: "far", latitude: 30.5, longitude: 78.9 }];
    const centre = routeCentre(withOutlier)!;

    // A mean latitude here would be pulled past 28.9; the median stays put.
    expect(centre.latitude).toBeLessThan(28.70);
  });
});

describe("findLocationOutliers", () => {
  it("finds a pin captured kilometres from the round", () => {
    const outliers = findLocationOutliers([
      ...NEARBY,
      { customerId: "stray", latitude: 28.75, longitude: 77.02 },
    ]);

    expect(outliers).toHaveLength(1);
    expect(outliers[0].customerId).toBe("stray");
    expect(outliers[0].distanceKm).toBeGreaterThan(2);
  });

  it("flags nothing when every pin is on the same round", () => {
    expect(findLocationOutliers(NEARBY)).toEqual([]);
  });

  it("stays quiet below the sample size — three pins have no meaningful centre", () => {
    const tiny = [
      { customerId: "a", latitude: 28.69, longitude: 76.91 },
      { customerId: "b", latitude: 28.69, longitude: 76.91 },
      { customerId: "far", latitude: 30.5, longitude: 78.9 },
    ];

    expect(findLocationOutliers(tiny)).toEqual([]);
  });

  it("does not let two bad pins excuse each other", () => {
    // The reason the centre is a median. With a mean, two strays pull the
    // centre toward themselves and both look acceptable.
    const outliers = findLocationOutliers([
      ...NEARBY,
      { customerId: "stray-1", latitude: 28.9, longitude: 77.2 },
      { customerId: "stray-2", latitude: 28.92, longitude: 77.22 },
    ]);

    expect(outliers.map((entry) => entry.customerId).sort()).toEqual(["stray-1", "stray-2"]);
  });

  it("orders worst first, so the list is a work queue", () => {
    const outliers = findLocationOutliers([
      ...NEARBY,
      { customerId: "near-stray", latitude: 28.72, longitude: 76.94 },
      { customerId: "far-stray", latitude: 29.2, longitude: 77.5 },
    ]);

    expect(outliers[0].customerId).toBe("far-stray");
  });
});

describe("isPlausibleCoordinate", () => {
  it("rejects null island, which is what a failed fix looks like", () => {
    expect(isPlausibleCoordinate(0, 0)).toBe(false);
  });

  it("rejects out-of-range and non-finite values", () => {
    expect(isPlausibleCoordinate(91, 76.9)).toBe(false);
    expect(isPlausibleCoordinate(28.69, 181)).toBe(false);
    expect(isPlausibleCoordinate(Number.NaN, 76.9)).toBe(false);
  });

  it("accepts a real address", () => {
    expect(isPlausibleCoordinate(28.690394, 76.911351)).toBe(true);
  });
});
