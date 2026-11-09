import { describe, expect, it } from "vitest";
import { classifyRecentOrder } from "@/lib/driver-suggestion";

const sheet = "2027-01-15";

describe("classifyRecentOrder", () => {
  it("pre-fills a product taken daily", () => {
    const entries = [14, 13, 12, 11].map((day) => ({ date: `2027-01-${day}`, quantity: 4 }));
    expect(classifyRecentOrder(entries, sheet)).toEqual({ usualQty: 4 });
  });

  it("uses the most recent quantity for a usual product", () => {
    expect(classifyRecentOrder([{ date: "2027-01-14", quantity: 3 }, { date: "2027-01-10", quantity: 5 }], sheet)).toEqual({ usualQty: 3 });
  });

  it("does not pre-fill a single recent delivery, it offers it instead", () => {
    expect(classifyRecentOrder([{ date: "2027-01-11", quantity: 1 }], sheet)).toEqual({
      occasional: { quantity: 1, date: "2027-01-11", daysAgo: 4 },
    });
  });

  it("treats two deliveries more than 14 days apart from today as occasional", () => {
    const entries = [{ date: "2027-01-10", quantity: 1 }, { date: "2026-12-20", quantity: 1 }];
    expect(classifyRecentOrder(entries, sheet).usualQty).toBeUndefined();
    expect(classifyRecentOrder(entries, sheet).occasional?.daysAgo).toBe(5);
  });

  it("counts a weekly product taken twice in the window as usual", () => {
    expect(classifyRecentOrder([{ date: "2027-01-12", quantity: 1 }, { date: "2027-01-05", quantity: 1 }], sheet)).toEqual({ usualQty: 1 });
  });

  it("suggests nothing for a delivery older than 30 days", () => {
    expect(classifyRecentOrder([{ date: "2026-12-01", quantity: 1 }], sheet)).toEqual({});
  });

  it("ignores deliveries dated after the sheet date and empty history", () => {
    expect(classifyRecentOrder([{ date: "2027-01-28", quantity: 1 }], sheet)).toEqual({});
    expect(classifyRecentOrder([], sheet)).toEqual({});
  });
});
