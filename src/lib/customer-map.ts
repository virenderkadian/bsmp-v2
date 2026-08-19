import { getCurrentCityId } from "@/lib/current-city";
import { findLocationOutliers, routeCentre } from "@/lib/customer-location-math";
import { withDbTimeout } from "@/lib/db-timeout";
import { monthInputToDate } from "@/lib/monthly-route-sequence";
import { prisma } from "@/lib/prisma";

export type CustomerMapPin = {
  customerId: string;
  code: string;
  name: string;
  area: string | null;
  mobile: string | null;
  latitude: number | null;
  longitude: number | null;
  // Sequence position on the selected route, when one is selected. Numbered
  // pins are what make a zig-zagging round visible at a glance.
  sequenceNo: number | null;
  routeCode: string | null;
  // How far this pin sits from its route's centre, when it's far enough to be
  // worth questioning. Null otherwise.
  outlierKm: number | null;
};

export type CustomerMapPayload = {
  dbConnected: boolean;
  pins: CustomerMapPin[];
  routes: Array<{ id: string; code: string; name: string }>;
  areas: string[];
  selectedRouteId: string;
  selectedMonth: string;
  // Centre for the initial map view — the median of whatever is being shown,
  // so the map opens on the data rather than on a hardcoded city.
  centre: { latitude: number; longitude: number } | null;
  counts: { total: number; located: number; missing: number; outliers: number };
  error?: string;
};

function currentMonthInput(): string {
  return new Date().toISOString().slice(0, 7);
}

// Customers as map pins, with locations captured by the driver app.
//
// Outliers are computed PER ROUTE rather than across the whole city: a city
// spans several rounds that are each geographically tight but far from one
// another, so a city-wide centre would flag entire legitimate routes. The
// question being asked is "is this pin far from the round it belongs to",
// which only makes sense within a route.
export async function getCustomerMapPayload(input?: {
  routeId?: string;
  month?: string;
}): Promise<CustomerMapPayload> {
  const selectedMonth = input?.month && /^\d{4}-\d{2}$/.test(input.month) ? input.month : currentMonthInput();
  const selectedRouteId = input?.routeId && input.routeId !== "all" ? input.routeId : "";

  try {
    const cityId = await getCurrentCityId();
    const sequenceMonth = monthInputToDate(selectedMonth);

    const [routes, customers, sequences] = await withDbTimeout(
      Promise.all([
        prisma.route.findMany({
          where: { cityId, isActive: true },
          orderBy: [{ shift: "asc" }, { code: "asc" }],
          select: { id: true, code: true, name: true },
        }),
        prisma.customer.findMany({
          where: { cityId, isActive: true },
          orderBy: { code: "asc" },
          select: { id: true, code: true, name: true, area: true, mobile: true, latitude: true, longitude: true },
        }),
        prisma.monthlyRouteCustomerSequence.findMany({
          where: { route: { cityId }, sequenceMonth, status: "ACTIVE" },
          select: { customerId: true, sequenceNo: true, routeId: true, route: { select: { code: true } } },
        }),
      ]),
      "Customer map request",
    );

    const sequenceByCustomer = new Map(sequences.map((row) => [row.customerId, row]));

    // Outliers are judged within each route, so group first.
    const byRoute = new Map<string, Array<{ customerId: string; latitude: number; longitude: number }>>();
    customers.forEach((customer) => {
      const sequence = sequenceByCustomer.get(customer.id);
      if (!sequence || customer.latitude === null || customer.longitude === null) {
        return;
      }
      const list = byRoute.get(sequence.routeId) ?? [];
      list.push({ customerId: customer.id, latitude: Number(customer.latitude), longitude: Number(customer.longitude) });
      byRoute.set(sequence.routeId, list);
    });

    const outlierKmByCustomer = new Map<string, number>();
    byRoute.forEach((located) => {
      findLocationOutliers(located).forEach((outlier) => {
        outlierKmByCustomer.set(outlier.customerId, outlier.distanceKm);
      });
    });

    const allPins: CustomerMapPin[] = customers.map((customer) => {
      const sequence = sequenceByCustomer.get(customer.id);
      return {
        customerId: customer.id,
        code: customer.code,
        name: customer.name,
        area: customer.area,
        mobile: customer.mobile,
        latitude: customer.latitude === null ? null : Number(customer.latitude),
        longitude: customer.longitude === null ? null : Number(customer.longitude),
        sequenceNo: sequence?.sequenceNo ?? null,
        routeCode: sequence?.route.code ?? null,
        outlierKm: outlierKmByCustomer.get(customer.id) ?? null,
      };
    });

    // Route filtering happens server-side because it depends on the monthly
    // sequence; everything else (area, search, located/missing) is cheap to do
    // in the browser and feels instant there.
    const pins = selectedRouteId
      ? allPins.filter((pin) => sequenceByCustomer.get(pin.customerId)?.routeId === selectedRouteId)
      : allPins;

    const located = pins.filter((pin) => pin.latitude !== null && pin.longitude !== null);

    return {
      dbConnected: true,
      pins,
      routes,
      areas: [...new Set(customers.map((customer) => customer.area).filter((area): area is string => Boolean(area)))].sort(),
      selectedRouteId,
      selectedMonth,
      centre: routeCentre(
        located.map((pin) => ({ customerId: pin.customerId, latitude: pin.latitude!, longitude: pin.longitude! })),
      ),
      counts: {
        total: pins.length,
        located: located.length,
        missing: pins.length - located.length,
        outliers: pins.filter((pin) => pin.outlierKm !== null).length,
      },
    };
  } catch (error) {
    return {
      dbConnected: false,
      pins: [],
      routes: [],
      areas: [],
      selectedRouteId,
      selectedMonth,
      centre: null,
      counts: { total: 0, located: 0, missing: 0, outliers: 0 },
      error: error instanceof Error ? error.message : "Unable to load the customer map.",
    };
  }
}
