import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Alert, PixelRatio, Pressable, Text, View } from "react-native";
import { useEffect, useState } from "react";
import type { DriverRoute } from "@shared/driver-api-types";
import { useActiveRoute } from "@/active-route";
import { radius } from "@/theme";
import { Card, Chip, PrimaryButton, ProgressBar, useColors } from "@/ui";
import { isRouteCompleted } from "@/route-completion";
import { fetchRouteProgress, isEditableCycleDate, type RouteProgress } from "@/route-progress";
import { todayStr } from "@/local-date";

// `compact`: the dashboard's slim row — shift icon, status line, thin progress
// bar and a short action button — instead of the full card the Delivery tab uses.
export function RouteCard({ route, date, serverToday, compact = false }: { route: DriverRoute; date?: string; serverToday?: string; compact?: boolean }) {
  const colors = useColors();
  const router = useRouter();
  const { activeRoute, completedRouteIds, progress, routesInfo } = useActiveRoute();

  const today = serverToday ?? todayStr();
  const isThisRouteActive = activeRoute?.id === route.id && (date ?? today) === today;
  const routeDate = date ?? today;
  const [datedCompleted, setDatedCompleted] = useState(false);
  useEffect(() => { void isRouteCompleted(route.id, routeDate).then(setDatedCompleted); }, [route.id, routeDate]);
  const past = routeDate < today;
  // For a past round (this cycle's evening, run yesterday) the shared progress
  // only covers today, so read how many stops were actually delivered on that
  // date. Without it the card could only go by the "Finish" marker stored on
  // this phone — and showed "Start round" for a round that was fully delivered
  // (finished on another phone, or never tapped Finish).
  const [pastProgress, setPastProgress] = useState<RouteProgress | null>(null);
  useEffect(() => {
    if (!past) return;
    let cancelled = false;
    void fetchRouteProgress([route], routeDate).then((result) => {
      if (!cancelled) setPastProgress(result[route.id] ?? null);
    });
    return () => { cancelled = true; };
    // Keyed by id: the dashboard hands down a fresh `route` object on every
    // refresh, and re-reading the past sheet each time would defeat the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [past, route.id, routeDate]);
  const routeProgress = past ? pastProgress ?? undefined : routeDate === today ? progress[route.id] : undefined;
  // A past round can never be "started" any more, so there is no active-route
  // guard to protect, and it is safe to read it as finished once every stop
  // has a saved line. (For TODAY's round that inference is deliberately not
  // made — see route-completion.ts.)
  const pastAllDelivered = past && !!pastProgress && pastProgress.total > 0 && pastProgress.done === pastProgress.total;
  const pastPartial = past && !!pastProgress && pastProgress.done > 0 && !pastAllDelivered;
  const isCompleted = (routeDate === today ? completedRouteIds.has(route.id) : datedCompleted) || pastAllDelivered;
  // Only one route can be "in progress" at a time — a partially-completed
  // round left behind would be easy to forget about otherwise. A route stays
  // active until the driver explicitly finishes it, so this now also catches
  // the "every stop marked but never finished" case.
  // Only starting a round is blocked by another one being in progress; looking
  // at a finished or past round is harmless.
  // A previous cycle can only be looked at, never started or changed.
  const viewOnly = !!routesInfo && !isEditableCycleDate(route.shift, routeDate, routesInfo.cycleDate);
  const viewing = isCompleted || pastPartial || viewOnly;
  const blockedByOther = !viewing && activeRoute !== null && (activeRoute.id !== route.id || routeDate !== today);
  const future = routeDate > today;

  const handlePress = () => {
    if (blockedByOther && activeRoute) {
      const remaining = activeRoute.progress.total - activeRoute.progress.done;
      const detail =
        remaining > 0
          ? `${activeRoute.code} still has ${remaining} stop${remaining === 1 ? "" : "s"} left today.`
          : `${activeRoute.code} has every stop marked but hasn't been finished yet.`;
      Alert.alert("Finish your active route first", `${detail} Finish it before starting another route.`, [
        { text: "Cancel", style: "cancel" },
        { text: "Go to it", onPress: () => router.push(`/run/${activeRoute.id}`) },
      ]);
      return;
    }
    router.push({ pathname: "/run/[routeId]", params: { routeId: route.id, date: routeDate } });
  };

  if (compact) {
    const shown = isThisRouteActive && !isCompleted ? activeRoute.progress : routeProgress;
    const fraction = shown && shown.total > 0 ? shown.done / shown.total : 0;
    const status = future
      ? { text: "Available on route date", color: colors.inkFaint }
      : isCompleted
        ? { text: shown ? `Completed · ${shown.done}/${shown.total} stops` : "Completed", color: colors.delivered }
        : pastPartial && pastProgress
          ? { text: `${pastProgress.done}/${pastProgress.total} delivered`, color: colors.skipped }
          : isThisRouteActive
            ? { text: `${activeRoute.progress.done}/${activeRoute.progress.total} stops · in progress`, color: colors.brand }
            : viewOnly
              ? { text: "Previous cycle", color: colors.inkFaint }
              : { text: "Not started", color: colors.inkFaint };
    const shortLabel = future ? "Soon" : isCompleted ? "Summary" : pastPartial || viewOnly ? "View" : isThisRouteActive ? "Continue" : "Start";
    // Big text: the name, status and button cannot share one row without the
    // text being cut to "RTE01 ·…", so the button drops under them.
    const stacked = PixelRatio.getFontScale() > 1.25;
    const dayLabel = new Date(`${routeDate}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
    return (
      <Card style={{ marginBottom: 10, padding: 14 }}>
        <View style={{ flexDirection: stacked ? "column" : "row", alignItems: stacked ? "stretch" : "center", gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: stacked ? 0 : 1 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandTint, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={route.shift === "EVENING" ? "moon" : "sunny"} size={20} color={colors.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "800" }} numberOfLines={stacked ? 3 : 1}>{route.code} · {route.name}</Text>
            <Text style={{ fontSize: 12.5, marginTop: 2 }} numberOfLines={stacked ? 4 : 1}>
              <Text style={{ color: colors.inkFaint }}>{route.shift === "EVENING" ? "Evening" : "Morning"} · {dayLabel}  ·  </Text>
              <Text style={{ color: status.color, fontWeight: "700" }}>{status.text}</Text>
            </Text>
          </View>
          </View>
          <Pressable
            onPress={handlePress}
            disabled={future}
            style={({ pressed }) => ({ minHeight: 38, paddingVertical: 4, paddingHorizontal: 16, borderRadius: radius.md, alignItems: "center", justifyContent: "center",
              backgroundColor: future ? colors.surface2 : isCompleted ? colors.brandTint : colors.brand, opacity: pressed ? 0.75 : 1 })}
          >
            <Text style={{ color: future ? colors.inkFaint : isCompleted ? colors.brand : colors.onBrand, fontSize: 14, fontWeight: "800" }}>{shortLabel}</Text>
          </Pressable>
        </View>
        {fraction > 0 ? <View style={{ marginTop: 12 }}><ProgressBar value={fraction} /></View> : null}
      </Card>
    );
  }

  return (
    <Card style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "800", flexShrink: 1 }}>
          {route.code} · {route.name}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {isCompleted ? <Chip label="Completed" tone="delivered" /> : null}
          <Chip label={route.shift === "MORNING" ? "Morning" : "Evening"} tone="brand" />
        </View>
      </View>
      <Text style={{ color: colors.inkSoft, fontSize: 12, marginTop: 6 }}>{routeDate}</Text>
      {isCompleted && routeProgress ? (
        <Text style={{ color: colors.delivered, fontSize: 12.5, fontWeight: "700", marginTop: 8 }}>
          {routeProgress.done}/{routeProgress.total} stops · finished
        </Text>
      ) : pastPartial && pastProgress ? (
        <Text style={{ color: colors.skipped, fontSize: 12.5, fontWeight: "700", marginTop: 8 }}>
          {pastProgress.done}/{pastProgress.total} stops delivered
        </Text>
      ) : isThisRouteActive ? (
        <Text style={{ color: colors.brand, fontSize: 12.5, fontWeight: "700", marginTop: 8 }}>
          {activeRoute.progress.done}/{activeRoute.progress.total} stops done · in progress
        </Text>
      ) : null}
      <View style={{ marginTop: 12 }}>
        <PrimaryButton
          label={future ? "Available on route date" : isCompleted ? "View summary" : pastPartial || viewOnly ? "View round" : isThisRouteActive ? "Continue round" : "Start round"}
          onPress={handlePress}
          disabled={future}
        />
      </View>
    </Card>
  );
}
