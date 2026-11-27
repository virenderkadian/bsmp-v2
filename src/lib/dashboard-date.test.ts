import { describe, expect, it } from "vitest";
import { resolveDashboardDate, todayInIndia } from "@/lib/dashboard-date";

describe("dashboard date", () => {
  it("keeps a valid date from the URL", () => {
    expect(resolveDashboardDate("2026-11-20", new Date("2026-11-27T10:00:00Z"))).toBe("2026-11-20");
  });

  it("falls back to today for missing, malformed or impossible dates", () => {
    const now = new Date("2026-11-27T10:00:00Z");
    for (const bad of [undefined, "", "yesterday", "2026-13-01", "2026-02-30", "2026-1-5"]) {
      expect(resolveDashboardDate(bad, now)).toBe("2026-11-27");
    }
  });

  it("uses the India date, which is already tomorrow after 18:30 UTC", () => {
    expect(todayInIndia(new Date("2026-11-27T19:00:00Z"))).toBe("2026-11-28");
    expect(todayInIndia(new Date("2026-11-27T18:00:00Z"))).toBe("2026-11-27");
  });
});
