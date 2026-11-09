import { useRouter } from "expo-router";
import { Alert, Text, View } from "react-native";
import { useEffect, useState } from "react";
import type { DriverRoute } from "@shared/driver-api-types";
import { useActiveRoute } from "@/active-route";
import { Card, Chip, PrimaryButton, useColors } from "@/ui";
import { isRouteCompleted } from "@/route-completion";
import { todayStr } from "@/local-date";

export function RouteCard({ route, date, serverToday }: { route: DriverRoute; date?: string; serverToday?: string }) {
  const colors = useColors();
  const router = useRouter();
  const { activeRoute, completedRouteIds, progress } = useActiveRoute();

  const today = serverToday ?? todayStr();
  const isThisRouteActive = activeRoute?.id === route.id && (date ?? today) === today;
  const routeDate = date ?? today;
  const [datedCompleted, setDatedCompleted] = useState(false);
  useEffect(() => { void isRouteCompleted(route.id, routeDate).then(setDatedCompleted); }, [route.id, routeDate]);
  const isCompleted = routeDate === today ? completedRouteIds.has(route.id) : datedCompleted;
  const routeProgress = routeDate === today ? progress[route.id] : undefined;
  // Only one route can be "in progress" at a time — a partially-completed
  // round left behind would be easy to forget about otherwise. A route stays
  // active until the driver explicitly finishes it, so this now also catches
  // the "every stop marked but never finished" case.
  const blockedByOther = activeRoute !== null && (activeRoute.id !== route.id || routeDate !== today);
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
      ) : isThisRouteActive ? (
        <Text style={{ color: colors.brand, fontSize: 12.5, fontWeight: "700", marginTop: 8 }}>
          {activeRoute.progress.done}/{activeRoute.progress.total} stops done · in progress
        </Text>
      ) : null}
      <View style={{ marginTop: 12 }}>
        <PrimaryButton
          label={future ? "Available on route date" : isCompleted ? "View summary" : isThisRouteActive ? "Continue round" : "Start round"}
          onPress={handlePress}
          disabled={future}
        />
      </View>
    </Card>
  );
}
