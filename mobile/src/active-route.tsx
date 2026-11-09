import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { api } from "@/api";
import { getCompletedRouteIds } from "@/route-completion";
import type { DriverRoute } from "@shared/driver-api-types";
import { fetchRouteProgress, findActiveRoute, todayStr, type ActiveRouteInfo, type RouteProgress } from "@/route-progress";
import { useSession } from "@/session";

type ActiveRouteValue = {
  activeRoute: ActiveRouteInfo | null;
  // Today's locally-marked completions and per-route progress, exposed so the
  // route list can render a "Completed" state without re-fetching either.
  completedRouteIds: Set<string>;
  progress: Record<string, RouteProgress>;
  // The routes list and the reconciliation cycle it was fetched for, so any
  // screen can tell which route is this cycle's morning route.
  routesInfo: { routes: DriverRoute[]; today: string; cycleDate: string } | null;
  refresh: () => void;
};

const ActiveRouteContext = createContext<ActiveRouteValue>({
  activeRoute: null,
  completedRouteIds: new Set(),
  progress: {},
  routesInfo: null,
  refresh: () => undefined,
});

// Tracks whether the signed-in vehicle has a route "in progress" right now
// (see findActiveRoute), app-wide — one poller instead of every screen
// re-deriving it. Backs both the floating resume pill (any screen) and the
// route-start guard (Dashboard/Delivery), so they can never disagree.
//
// Combines two sources: server-side progress (how many stops are saved) and
// the device's local completion markers (whether the driver tapped Finish).
// Both are needed — a route is only "not active" once it's explicitly done.
//
// Refreshed on mount, when the app returns to the foreground, on a slow
// fallback poll, and explicitly after every save from the run screen — the
// combination means the indicator is never stale by more than a moment even
// though the underlying state (saved daily-entry lines) has no push channel.
export function ActiveRouteProvider({ children }: { children: ReactNode }) {
  const { token } = useSession();
  const [activeRoute, setActiveRoute] = useState<ActiveRouteInfo | null>(null);
  const [completedRouteIds, setCompletedRouteIds] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Record<string, RouteProgress>>({});
  const [routesInfo, setRoutesInfo] = useState<ActiveRouteValue["routesInfo"]>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(() => {
    if (!token || inFlight.current) return;
    inFlight.current = true;
    (async () => {
      try {
        const { routes, today, cycleDate } = await api.routes();
        const date = todayStr();
        const [routeProgress, completed] = await Promise.all([
          fetchRouteProgress(routes, date),
          getCompletedRouteIds(date),
        ]);
        setProgress(routeProgress);
        // Together with progress, so a screen never sees one without the other
        // (it would briefly read "not started" while progress was still loading).
        setRoutesInfo({ routes, today, cycleDate });
        setCompletedRouteIds(completed);
        setActiveRoute(findActiveRoute(routes, routeProgress, completed));
      } catch {
        // Silent — a background convenience indicator, not a critical path.
      } finally {
        inFlight.current = false;
      }
    })();
  }, [token]);

  useEffect(() => {
    if (!token) {
      setActiveRoute(null);
      setCompletedRouteIds(new Set());
      setProgress({});
      setRoutesInfo(null);
      return;
    }
    refresh();
    const poll = setInterval(refresh, 60_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      clearInterval(poll);
      subscription.remove();
    };
  }, [token, refresh]);

  return (
    <ActiveRouteContext.Provider value={{ activeRoute, completedRouteIds, progress, routesInfo, refresh }}>
      {children}
    </ActiveRouteContext.Provider>
  );
}

export function useActiveRoute(): ActiveRouteValue {
  return useContext(ActiveRouteContext);
}

// Has this reconciliation cycle's MORNING route been started?
//
// Expected cash is only meaningful once the morning round is under way: before
// that, no morning sales have been recorded, so almost everything given to the
// vehicle looks "left" and the figure is a large number that means nothing.
// "Started" is the app's own definition of in progress — at least one stop is
// saved — or the driver has finished the route. After 4 pm the cycle moves on
// to tomorrow's morning, which cannot have started, so this is false until
// that route is under way.
//   null  -> not known yet (still loading)
export function useMorningStarted(): boolean | null {
  const { routesInfo, progress, completedRouteIds } = useContext(ActiveRouteContext);
  if (!routesInfo) return null;
  const morning = routesInfo.routes.find((route) => route.shift === "MORNING");
  if (!morning || routesInfo.cycleDate !== routesInfo.today) return false;
  return (progress[morning.id]?.done ?? 0) > 0 || completedRouteIds.has(morning.id);
}
