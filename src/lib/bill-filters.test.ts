import { describe, expect, it } from "vitest";
import {
  billFiltersFromParams,
  billFiltersToParams,
  describeBillFilters,
  emptyBillFilters,
  hasActiveBillFilters,
  matchesBillFilters,
  sumBillRows,
  type BillFilters,
} from "@/lib/bill-filters";

function row(overrides: Partial<Parameters<typeof matchesBillFilters>[0]> = {}) {
  return {
    customerCode: "BHCID0038",
    customerName: "2294 SEC 2",
    customerArea: "SEC 2",
    status: "LOCKED" as string | null,
    pendingAmount: "1200.00",
    deliveryAmount: "5000.00",
    ...overrides,
  };
}

function filters(overrides: Partial<BillFilters> = {}): BillFilters {
  return { ...emptyBillFilters, ...overrides };
}

describe("matchesBillFilters", () => {
  it("keeps every row when nothing is filtered", () => {
    expect(matchesBillFilters(row(), filters())).toBe(true);
  });

  it("excludes a customer with no bill when filtering by status", () => {
    // A null status is "no bill yet" — not a Draft, and not a match for one.
    expect(matchesBillFilters(row({ status: null }), filters({ status: "DRAFT" }))).toBe(false);
    expect(matchesBillFilters(row({ status: null }), filters())).toBe(true);
  });

  it("searches code, name and area", () => {
    expect(matchesBillFilters(row(), filters({ search: "2294" }))).toBe(true);
    expect(matchesBillFilters(row(), filters({ search: "bhcid0038" }))).toBe(true);
    expect(matchesBillFilters(row(), filters({ search: "sec 2" }))).toBe(true);
    expect(matchesBillFilters(row(), filters({ search: "sec 6" }))).toBe(false);
  });

  it("tolerates a customer with no area", () => {
    // Area is the only field that can be absent, so a search that would have
    // matched on it must miss rather than throw.
    const noArea = row({ customerName: "AMIT GYM", customerArea: null });
    expect(matchesBillFilters(noArea, filters({ search: "sec 2" }))).toBe(false);
    expect(matchesBillFilters(noArea, filters({ search: "amit" }))).toBe(true);
  });

  it("applies the amount bounds to the chosen field", () => {
    // Pending is 1,200 and the bill is 5,000 — the same row is in or out
    // depending only on which figure the bound is read against.
    expect(matchesBillFilters(row(), filters({ minAmount: "2000" }))).toBe(false);
    expect(
      matchesBillFilters(row(), filters({ minAmount: "2000", amountField: "deliveryAmount" })),
    ).toBe(true);
    expect(matchesBillFilters(row(), filters({ maxAmount: "1500" }))).toBe(true);
    expect(matchesBillFilters(row(), filters({ minAmount: "1000", maxAmount: "1500" }))).toBe(true);
  });

  it("ignores a bound that isn't a number", () => {
    expect(matchesBillFilters(row(), filters({ minAmount: "abc" }))).toBe(true);
  });
});

describe("filters survive the trip to a print route", () => {
  it("round-trips every filter through the URL", () => {
    const original = filters({
      status: "GENERATED",
      search: "SEC 2",
      amountField: "deliveryAmount",
      minAmount: "500",
      maxAmount: "9000",
    });
    const restored = billFiltersFromParams(
      Object.fromEntries(billFiltersToParams(original).entries()),
    );
    expect(restored).toEqual(original);
  });

  it("writes nothing for an unfiltered print", () => {
    expect(billFiltersToParams(filters()).toString()).toBe("");
  });

  it("keeps the amount field only when a bound uses it", () => {
    expect(billFiltersToParams(filters({ amountField: "deliveryAmount" })).toString()).toBe("");
    expect(
      billFiltersToParams(filters({ amountField: "deliveryAmount", minAmount: "10" })).toString(),
    ).toContain("amountField=deliveryAmount");
  });

  it("falls back to pending for an unknown amount field", () => {
    expect(billFiltersFromParams({ amountField: "nonsense" }).amountField).toBe("closingBalance");
  });
});

describe("hasActiveBillFilters", () => {
  it("does not count the amount field on its own as a filter", () => {
    // Choosing which figure to bound filters nothing until a bound is typed.
    expect(hasActiveBillFilters(filters({ amountField: "deliveryAmount" }))).toBe(false);
    expect(hasActiveBillFilters(filters({ minAmount: "10" }))).toBe(true);
    expect(hasActiveBillFilters(filters({ search: "  " }))).toBe(false);
  });
});

describe("describeBillFilters", () => {
  it("says nothing when nothing is filtered", () => {
    expect(describeBillFilters(filters())).toBeNull();
  });

  it("spells out what a printed sheet is missing", () => {
    expect(describeBillFilters(filters({ status: "LOCKED", minAmount: "500" }))).toBe(
      "Filtered: Locked bills only, pending of ₹500 or more",
    );
    expect(
      describeBillFilters(filters({ minAmount: "100", maxAmount: "900", amountField: "deliveryAmount" })),
    ).toBe("Filtered: bill amount between ₹100 and ₹900");
  });
});

describe("sumBillRows", () => {
  it("totals only the rows it is given", () => {
    const totals = sumBillRows([
      {
        productQuantities: { milk: "10.5", dahi: "1" },
        deliveryAmount: "1000.00",
        openingBalance: "200.00",
        paymentAmount: "500.00",
        pendingAmount: "700.00",
      },
      {
        productQuantities: { milk: "4.25" },
        deliveryAmount: "425.50",
        openingBalance: "0.00",
        paymentAmount: "0.00",
        pendingAmount: "425.50",
      },
    ]);

    expect(totals.deliveryAmount).toBe("1425.50");
    expect(totals.pendingAmount).toBe("1125.50");
    expect(totals.productQuantities.milk).toBe("14.750");
    expect(totals.productQuantities.dahi).toBe("1.000");
  });

  it("returns zeroes rather than blanks for an empty sheet", () => {
    const totals = sumBillRows([]);
    expect(totals.deliveryAmount).toBe("0.00");
    expect(totals.productQuantities).toEqual({});
  });
});
