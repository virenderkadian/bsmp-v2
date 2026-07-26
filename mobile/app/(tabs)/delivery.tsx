import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { DriverRoute } from "@shared/driver-api-types";
import { api, ApiError } from "@/api";
import { RouteCard } from "@/route-card";
import { Card, ScreenTitle, useColors } from "@/ui";

export default function DeliveryScreen() {
  const colors = useColors();
  const [routes, setRoutes] = useState<DriverRoute[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const result = await api.routes();
      setRoutes(result.routes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your routes.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const count = routes?.length ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={{ padding: 18, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      >
        <ScreenTitle title="Delivery" subtitle={routes ? `${count} route${count === 1 ? "" : "s"} assigned` : undefined} />

        {error ? (
          <Card style={{ marginBottom: 12 }}>
            <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text>
          </Card>
        ) : null}

        {!routes && !error ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 20 }} />
        ) : routes && routes.length === 0 ? (
          <Card>
            <Text style={{ color: colors.inkSoft, fontSize: 14 }}>No routes assigned to this vehicle yet.</Text>
          </Card>
        ) : (
          routes?.map((route) => <RouteCard key={route.id} route={route} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
