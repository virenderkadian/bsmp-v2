import { describe, expect, it } from "vitest";
import { groupRoutesByVehicle } from "@/lib/dashboard-routes";
import type { RouteReadinessRow, RouteSummaryRow } from "@/lib/dashboard";

const route = (over: Partial<RouteReadinessRow>): RouteReadinessRow => ({
  routeId: "r", routeCode: "R1", routeName: "Route", shift: "MORNING",
  vehicleId: "v1", vehicleCode: "V1", vehicleName: "Van 1", hasEntryToday: false, ...over,
});

describe("groupRoutesByVehicle", () => {
  it("groups by vehicle, puts routes with no vehicle last, and totals products and amount", () => {
    const readiness = [
      route({ routeId: "a", routeCode: "A", vehicleId: "v2", vehicleCode: "V2", vehicleName: "Van 2", hasEntryToday: true }),
      route({ routeId: "b", routeCode: "B", vehicleId: null, vehicleCode: null, vehicleName: null }),
      route({ routeId: "c", routeCode: "C", hasEntryToday: true }),
      route({ routeId: "d", routeCode: "D", shift: "EVENING", hasEntryToday: true }),
    ];
    const summary: RouteSummaryRow[] = [
      { routeId: "c", routeCode: "C", routeName: "Route", shift: "MORNING", quantityByProduct: { milk: "10.000" }, amount: "600.00" },
      { routeId: "d", routeCode: "D", routeName: "Route", shift: "EVENING", quantityByProduct: { milk: "5.000", curd: "2.000" }, amount: "400.00" },
      { routeId: "a", routeCode: "A", routeName: "Route", shift: "MORNING", quantityByProduct: { milk: "1.000" }, amount: "60.00" },
    ];

    const groups = groupRoutesByVehicle(readiness, summary);
    expect(groups.map((g) => g.vehicleName)).toEqual(["Van 1", "Van 2", "No vehicle assigned"]);
    expect(groups[0]).toMatchObject({ savedCount: 2, amount: 1000, quantityByProduct: { milk: 15, curd: 2 } });
    expect(groups[2].routes[0]).toMatchObject({ saved: false, amount: 0 });
  });

  it("lists routes still waiting for an entry first", () => {
    const groups = groupRoutesByVehicle(
      [
        route({ routeId: "a", routeCode: "A", hasEntryToday: true }),
        route({ routeId: "b", routeCode: "B", hasEntryToday: false }),
      ],
      [],
    );
    expect(groups[0].routes.map((r) => r.routeId)).toEqual(["b", "a"]);
  });
});
