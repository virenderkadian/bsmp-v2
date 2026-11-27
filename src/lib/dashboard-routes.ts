import type { RouteReadinessRow, RouteSummaryRow } from "@/lib/dashboard";

export type VehicleRouteRow = {
  routeId: string;
  routeCode: string;
  routeName: string;
  shift: "MORNING" | "EVENING";
  saved: boolean;
  quantityByProduct: Record<string, number>;
  amount: number;
};

export type VehicleRouteGroup = {
  vehicleId: string | null;
  vehicleCode: string | null;
  vehicleName: string;
  routes: VehicleRouteRow[];
  savedCount: number;
  quantityByProduct: Record<string, number>;
  amount: number;
};

// Joins "which routes have an entry" with "what each delivered" and groups them by the vehicle
// they run on. Routes with no vehicle form their own group, last. Inside a group the routes still
// waiting for an entry come first, because those are the ones that need someone's attention.
export function groupRoutesByVehicle(readiness: RouteReadinessRow[], summary: RouteSummaryRow[]): VehicleRouteGroup[] {
  const summaryByRoute = new Map(summary.map((row) => [row.routeId, row]));
  const groups = new Map<string, VehicleRouteGroup>();

  for (const route of readiness) {
    const key = route.vehicleId ?? "none";
    let group = groups.get(key);
    if (!group) {
      group = {
        vehicleId: route.vehicleId,
        vehicleCode: route.vehicleCode,
        vehicleName: route.vehicleName ?? "No vehicle assigned",
        routes: [],
        savedCount: 0,
        quantityByProduct: {},
        amount: 0,
      };
      groups.set(key, group);
    }

    const delivered = summaryByRoute.get(route.routeId);
    const quantityByProduct = Object.fromEntries(
      Object.entries(delivered?.quantityByProduct ?? {}).map(([productId, qty]) => [productId, Number(qty)]),
    );
    const amount = Number(delivered?.amount ?? 0);

    group.routes.push({
      routeId: route.routeId,
      routeCode: route.routeCode,
      routeName: route.routeName,
      shift: route.shift,
      saved: route.hasEntryToday,
      quantityByProduct,
      amount,
    });
    if (route.hasEntryToday) group.savedCount += 1;
    for (const [productId, qty] of Object.entries(quantityByProduct)) {
      group.quantityByProduct[productId] = (group.quantityByProduct[productId] ?? 0) + qty;
    }
    group.amount += amount;
  }

  for (const group of groups.values()) {
    group.routes.sort(
      (a, b) =>
        Number(a.saved) - Number(b.saved) ||
        (a.shift === b.shift ? 0 : a.shift === "MORNING" ? -1 : 1) ||
        a.routeCode.localeCompare(b.routeCode, undefined, { numeric: true }),
    );
  }

  return [...groups.values()].sort((a, b) => {
    if (a.vehicleId === null) return 1;
    if (b.vehicleId === null) return -1;
    return (a.vehicleCode ?? "").localeCompare(b.vehicleCode ?? "", undefined, { numeric: true });
  });
}
