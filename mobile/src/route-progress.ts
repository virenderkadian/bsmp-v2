import { api } from "@/api";
import type { DriverRoute } from "@shared/driver-api-types";

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

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
        const sheet = await api.sheet(route.id, date);
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

// A route counts as "in progress" once at least one stop is done but not all
// of them — that's the only state observable from saved daily-entry lines
// (there's no explicit start/stop marker), and it's exactly the state where
// resuming — or blocking a second route from starting — matters.
export function findActiveRoute(
  routes: DriverRoute[],
  progress: Record<string, RouteProgress>,
): ActiveRouteInfo | null {
  for (const route of routes) {
    const p = progress[route.id];
    if (p && p.total > 0 && p.done > 0 && p.done < p.total) {
      return { ...route, progress: p };
    }
  }
  return null;
}
