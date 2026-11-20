import { describe, expect, it } from "vitest";
import { filterRows, routeOptionsFor, vehicleOptionsFor, type PickerFilters, type PickerRow } from "@/app/whatsapp/recipient-filter";

const row = (id: string, amount: number, routeId: string, vehicleId: string, name = `Customer ${id}`): PickerRow => ({
  id, code: `C${id}`, name, detail: `₹${amount}`, amount,
  routeId, routeLabel: `${routeId.toUpperCase()} - Route ${routeId}`, vehicleId, vehicleLabel: `${vehicleId.toUpperCase()} - Van ${vehicleId}`,
});

const rows = [
  row("1", 500, "r1", "v1"),
  row("2", 1000, "r1", "v1"),
  row("3", 2500, "r2", "v1"),
  row("4", 100, "r3", "v2", "Sharma Dairy"),
  row("5", 9000, "r3", "v2"),
];
const none: PickerFilters = { search: "", routeId: "", vehicleId: "", minAmount: "", maxAmount: "" };
const ids = (list: PickerRow[]) => list.map((entry) => entry.id);

describe("filterRows", () => {
  it("shows everything with no filter", () => {
    expect(ids(filterRows(rows, none))).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("includes both ends of the amount range", () => {
    expect(ids(filterRows(rows, { ...none, minAmount: "1000", maxAmount: "2500" }))).toEqual(["2", "3"]);
  });

  it("supports a minimum only, a maximum only, and decimals", () => {
    expect(ids(filterRows(rows, { ...none, minAmount: "2500" }))).toEqual(["3", "5"]);
    expect(ids(filterRows(rows, { ...none, maxAmount: "500" }))).toEqual(["1", "4"]);
    expect(ids(filterRows(rows, { ...none, minAmount: "999.99", maxAmount: "1000.01" }))).toEqual(["2"]);
  });

  it("ignores a bound that isn't a number rather than hiding everyone", () => {
    expect(ids(filterRows(rows, { ...none, minAmount: "abc" }))).toHaveLength(5);
  });

  it("filters by route and by vehicle, and by both together", () => {
    expect(ids(filterRows(rows, { ...none, routeId: "r1" }))).toEqual(["1", "2"]);
    expect(ids(filterRows(rows, { ...none, vehicleId: "v1" }))).toEqual(["1", "2", "3"]);
    expect(ids(filterRows(rows, { ...none, vehicleId: "v1", routeId: "r3" }))).toEqual([]);
  });

  it("combines every filter, including the text search", () => {
    expect(ids(filterRows(rows, { search: "sharma", routeId: "r3", vehicleId: "v2", minAmount: "50", maxAmount: "200" }))).toEqual(["4"]);
    expect(ids(filterRows(rows, { ...none, search: "c3" }))).toEqual(["3"]);
  });

  it("never hides a row that has no amount (the waiting queue's rows have none)", () => {
    const plain: PickerRow[] = [{ id: "a", code: "A", name: "Aman", detail: "Monthly bill" }];
    expect(filterRows(plain, { ...none, minAmount: "100", maxAmount: "200" })).toHaveLength(1);
  });
});

describe("dropdown options", () => {
  it("lists each route and vehicle once, in order", () => {
    expect(routeOptionsFor(rows, "").map((option) => option.value)).toEqual(["r1", "r2", "r3"]);
    expect(vehicleOptionsFor(rows, "").map((option) => option.value)).toEqual(["v1", "v2"]);
  });

  it("offers only the routes of the chosen vehicle, and only the vehicles of the chosen route", () => {
    expect(routeOptionsFor(rows, "v1").map((option) => option.value)).toEqual(["r1", "r2"]);
    expect(routeOptionsFor(rows, "v2").map((option) => option.value)).toEqual(["r3"]);
    expect(vehicleOptionsFor(rows, "r3").map((option) => option.value)).toEqual(["v2"]);
  });
});
