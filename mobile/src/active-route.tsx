import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { api } from "@/api";
import { getCompletedRouteIds } from "@/route-completion";
import { fetchRouteProgress, findActiveRoute, todayStr, type ActiveRouteInfo, type RouteProgress } from "@/route-progress";
import { useSession } from "@/session";

type ActiveRouteValue = {
  activeRoute: ActiveRouteInfo | null;
  // Today's locally-marked completions and per-route progress, exposed so the
  // route list can render a "Completed" state without re-fetching either.
  completedRouteIds: Set<string>;
  progress: Record<string, RouteProgress>;
  refresh: () => void;
};

const ActiveRouteContext = createContext<ActiveRouteValue>({
  activeRoute: null,
  completedRouteIds: new Set(),
  progress: {},
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
  const inFlight = useRef(false);

  const refresh = useCallback(() => {
    if (!token || inFlight.current) return;
    inFlight.current = true;
    (async () => {
      try {
        const { routes } = await api.routes();
        const date = todayStr();
        const [routeProgress, completed] = await Promise.all([
          fetchRouteProgress(routes, date),
          getCompletedRouteIds(date),
        ]);
        setProgress(routeProgress);
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
    <ActiveRouteContext.Provider value={{ activeRoute, completedRouteIds, progress, refresh }}>
      {children}
    </ActiveRouteContext.Provider>
  );
}

export function useActiveRoute(): ActiveRouteValue {
  return useContext(ActiveRouteContext);
}
