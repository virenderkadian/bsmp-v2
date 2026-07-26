import { useRouter } from "expo-router";
import { Alert, Text, View } from "react-native";
import type { DriverRoute } from "@shared/driver-api-types";
import { useActiveRoute } from "@/active-route";
import { Card, Chip, PrimaryButton, useColors } from "@/ui";

export function RouteCard({ route }: { route: DriverRoute }) {
  const colors = useColors();
  const router = useRouter();
  const { activeRoute } = useActiveRoute();

  const isThisRouteActive = activeRoute?.id === route.id;
  // Only one route can be "in progress" at a time — a partially-completed
  // round left behind would be easy to forget about otherwise. Starting a
  // fresh (0-progress) or already-finished route is unaffected.
  const blockedByOther = activeRoute !== null && activeRoute.id !== route.id;

  const handlePress = () => {
    if (blockedByOther && activeRoute) {
      const remaining = activeRoute.progress.total - activeRoute.progress.done;
      Alert.alert(
        "Finish your active route first",
        `${activeRoute.code} still has ${remaining} stop${remaining === 1 ? "" : "s"} left today. Finish it before starting another route.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Go to it", onPress: () => router.push(`/run/${activeRoute.id}`) },
        ],
      );
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
        <Chip label={route.shift === "MORNING" ? "Morning" : "Evening"} tone="brand" />
      </View>
      {isThisRouteActive ? (
        <Text style={{ color: colors.brand, fontSize: 12.5, fontWeight: "700", marginTop: 8 }}>
          {activeRoute.progress.done}/{activeRoute.progress.total} stops done · in progress
        </Text>
      ) : null}
      <View style={{ marginTop: 12 }}>
        <PrimaryButton label={isThisRouteActive ? "Continue round" : "Start round"} onPress={handlePress} />
      </View>
    </Card>
  );
}
