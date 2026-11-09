import { api } from "@/api";
import type { DriverRoute } from "@shared/driver-api-types";

// Re-exported so the many callers that already reach for it here keep working.
export { todayStr, localDateStr } from "@/local-date";

export type RouteProgress = { done: number; total: number };

// One sheet fetch per route (a vehicle has at most a couple) to learn how far
// along today's round is. Failures are swallowed per-route (0/0, treated as
// "not in progress") — this powers a convenience indicator, not a source of
// truth the rest of the app depends on for correctness.
export async function fetchRouteProgress(
  routes: DriverRoute[],
  date: string,
): Promise<Record<string, RouteProgress>> {
  const entries = await Promise.all(
    routes.map(async (route): Promise<[string, RouteProgress]> => {
      try {
        const sheet = await api.sheet(route.id, date, { full: false });
        const total = sheet.customers.length;
        const done = sheet.customers.filter((customer) => customer.saved).length;
        return [route.id, { done, total }];
      } catch {
        return [route.id, { done: 0, total: 0 }];
      }
    }),
  );
  return Object.fromEntries(entries);
}

export type ActiveRouteInfo = DriverRoute & { progress: RouteProgress };

// A route counts as "in progress" once at least one stop is saved and the
// driver hasn't explicitly finished it (see route-completion.ts).
//
// Note there's deliberately NO upper bound at done === total: a route with
// every stop saved but no Finish tap is still in progress. Ending it at 100%
// would leave a dead zone — the resume pill would vanish and the one-active-
// route guard would release, even though the driver never said they were
// done, which is exactly the premature-completion problem this design fixes.
export function findActiveRoute(
  routes: DriverRoute[],
  progress: Record<string, RouteProgress>,
  completedRouteIds: Set<string>,
): ActiveRouteInfo | null {
  for (const route of routes) {
    const p = progress[route.id];
    if (p && p.total > 0 && p.done > 0 && !completedRouteIds.has(route.id)) {
      return { ...route, progress: p };
    }
  }
  return null;
}

// Routes in the order a reconciliation cycle runs them: the evening round
// first, then the morning round that follows it. The server lists morning
// first (its own sort), which read backwards against stock and cash, which
// always go evening -> morning.
export function inCycleOrder(routes: DriverRoute[]): DriverRoute[] {
  return [...routes].sort((a, b) =>
    a.shift === b.shift ? a.code.localeCompare(b.code, undefined, { numeric: true }) : a.shift === "EVENING" ? -1 : 1,
  );
}

// Only the CURRENT reconciliation cycle can be changed from the phone: its
// evening round (the day before the cycle date) and its morning round (the
// cycle date). Anything older — the "Previous cycle" on the Delivery tab, or a
// round the cycle has moved on from — is view-only.
export function isEditableCycleDate(shift: "MORNING" | "EVENING", date: string, cycleDate: string): boolean {
  if (shift === "MORNING") return date === cycleDate;
  const evening = new Date(`${cycleDate}T00:00:00Z`);
  evening.setUTCDate(evening.getUTCDate() - 1);
  return date === evening.toISOString().slice(0, 10);
}
