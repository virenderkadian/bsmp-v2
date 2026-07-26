import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import type { DriverRoute } from "@shared/driver-api-types";
import { Card, Chip, PrimaryButton, useColors } from "@/ui";

export function RouteCard({ route }: { route: DriverRoute }) {
  const colors = useColors();
  const router = useRouter();
  return (
    <Card style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "800", flexShrink: 1 }}>
          {route.code} · {route.name}
        </Text>
        <Chip label={route.shift === "MORNING" ? "Morning" : "Evening"} tone="brand" />
      </View>
      <View style={{ marginTop: 12 }}>
        <PrimaryButton label="Start round" onPress={() => router.push(`/run/${route.id}`)} />
      </View>
    </Card>
  );
}
