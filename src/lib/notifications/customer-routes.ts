import "server-only";
import { withDbTimeout } from "@/lib/db-timeout";
import { monthInputToDate } from "@/lib/monthly-route-sequence";
import { prisma } from "@/lib/prisma";

// Which route and vehicle each customer is on this month, so the office can pick or leave
// out a whole route or vehicle. A customer can run on two routes (morning and evening);
// they are shown on the one that bills them, else on any they run on.

export type CustomerRoute = {
  routeId: string;
  routeLabel: string;
  vehicleId: string;
  vehicleLabel: string;
};

function istMonth(now: Date): string {
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

export async function getCustomerRoutes(cityId: string, now = new Date()): Promise<Map<string, CustomerRoute>> {
  const sequences = await withDbTimeout(
    prisma.monthlyRouteCustomerSequence.findMany({
      where: { route: { cityId }, sequenceMonth: monthInputToDate(istMonth(now)), status: "ACTIVE" },
      select: {
        customerId: true,
        routeId: true,
        billsHere: true,
        route: { select: { code: true, name: true, vehicle: { select: { id: true, code: true, name: true } } } },
      },
    }),
    "Loading customer routes",
    20_000,
  );

  const best = new Map<string, (typeof sequences)[number]>();
  for (const row of sequences) {
    const current = best.get(row.customerId);
    if (!current || (row.billsHere && !current.billsHere)) best.set(row.customerId, row);
  }

  return new Map(
    [...best.entries()].map(([customerId, row]) => [
      customerId,
      {
        routeId: row.routeId,
        routeLabel: `${row.route.code} - ${row.route.name}`,
        vehicleId: row.route.vehicle.id,
        vehicleLabel: `${row.route.vehicle.code} - ${row.route.vehicle.name}`,
      },
    ]),
  );
}

export const NO_ROUTE: CustomerRoute = { routeId: "", routeLabel: "", vehicleId: "", vehicleLabel: "" };
