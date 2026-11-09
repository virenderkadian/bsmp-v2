import { describe, expect, it } from "vitest";
import { expectedStock, expectedStockTotal, nextStockTotals, stockWindow, validDay } from "@/lib/driver-stock-rules";

describe("driver stock cycle", () => {
  it("switches to the evening cycle at 4 pm India time", () => {
    expect(stockWindow(new Date("2026-11-08T10:29:59Z"))).toMatchObject({ cycleDate: "2026-11-08", shift: "MORNING" });
    expect(stockWindow(new Date("2026-11-08T10:30:00Z"))).toMatchObject({ cycleDate: "2026-11-09", eveningDate: "2026-11-08", shift: "EVENING" });
  });

  it("rejects impossible cycle dates", () => {
    expect(validDay("2026-11-08")).toBe(true);
    expect(validDay("2026-11-31")).toBe(false);
  });

  it("nets the fridge return and morning refill without double counting", () => {
    let stock = { given: 0, returned: 0 };
    stock = nextStockTotals(stock.given, stock.returned, "EVENING_TAKEN", 100);
    stock = nextStockTotals(stock.given, stock.returned, "EVENING_RETURN", 20);
    stock = nextStockTotals(stock.given, stock.returned, "MORNING_REFILL", 40);
    stock = nextStockTotals(stock.given, stock.returned, "MORNING_RETURN", 10);
    expect(stock).toEqual({ given: 120, returned: 10 });
  });

  it("matches the worked reconciliation example (100 given, 40 + 50 sold, 2 returned = 8)", () => {
    const milk = { given: "100", returned: "2", eveningSold: "40", morningSold: "50", rate: "60" };
    expect(expectedStock(milk)).toEqual({ qty: 8, amount: 480 });
    expect(expectedStockTotal([milk, { ...milk, given: "10", returned: "0", eveningSold: "4", morningSold: "5", rate: "50" }])).toBe(530);
  });

  it("reports a shortage as negative", () => {
    expect(expectedStock({ given: "10", returned: "0", eveningSold: "6", morningSold: "5", rate: "50" })).toEqual({ qty: -1, amount: -50 });
  });
});
