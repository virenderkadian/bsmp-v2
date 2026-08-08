import { useRouter } from "expo-router";
import { Alert, Text, View } from "react-native";
import type { DriverRoute } from "@shared/driver-api-types";
import { useActiveRoute } from "@/active-route";
import { Card, Chip, PrimaryButton, useColors } from "@/ui";

export function RouteCard({ route }: { route: DriverRoute }) {
  const colors = useColors();
  const router = useRouter();
  const { activeRoute, completedRouteIds, progress } = useActiveRoute();

  const isThisRouteActive = activeRoute?.id === route.id;
  const isCompleted = completedRouteIds.has(route.id);
  const routeProgress = progress[route.id];
  // Only one route can be "in progress" at a time — a partially-completed
  // round left behind would be easy to forget about otherwise. A route stays
  // active until the driver explicitly finishes it, so this now also catches
  // the "every stop marked but never finished" case.
  const blockedByOther = activeRoute !== null && activeRoute.id !== route.id;

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
    router.push(`/run/${route.id}`);
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
      {isCompleted && routeProgress ? (
        <Text style={{ color: colors.delivered, fontSize: 12.5, fontWeight: "700", marginTop: 8 }}>
          {routeProgress.done}/{routeProgress.total} stops · finished today
        </Text>
      ) : isThisRouteActive ? (
        <Text style={{ color: colors.brand, fontSize: 12.5, fontWeight: "700", marginTop: 8 }}>
          {activeRoute.progress.done}/{activeRoute.progress.total} stops done · in progress
        </Text>
      ) : null}
      <View style={{ marginTop: 12 }}>
        <PrimaryButton
          label={isCompleted ? "View summary" : isThisRouteActive ? "Continue round" : "Start round"}
          onPress={handlePress}
        />
      </View>
    </Card>
  );
}
