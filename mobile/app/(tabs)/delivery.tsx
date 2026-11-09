import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { DriverRoutesResponse } from "@shared/driver-api-types";
import { api, ApiError } from "@/api";
import { TAB_BAR_HEIGHT } from "@/components/ActiveRoutePill";
import { CycleSwitch } from "@/components/CycleSwitch";
import { RouteCard } from "@/route-card";
import { inCycleOrder } from "@/route-progress";
import { Card, ScreenTitle, useColors } from "@/ui";

export default function DeliveryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<DriverRoutesResponse | null>(null);
  const [previous, setPrevious] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const result = await api.routes();
      setData(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your routes.");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const count = data?.routes.length ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={{ padding: 18, paddingBottom: 24 + insets.bottom + TAB_BAR_HEIGHT }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      >
        <ScreenTitle title="Delivery" subtitle={data ? `${count} route${count === 1 ? "" : "s"} assigned` : undefined} />
        {data ? <CycleSwitch previous={previous} onChange={setPrevious} /> : null}

        {error ? (
          <Card style={{ marginBottom: 12 }}>
            <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text>
          </Card>
        ) : null}

        {!data && !error ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 20 }} />
        ) : data && data.routes.length === 0 ? (
          <Card>
            <Text style={{ color: colors.inkSoft, fontSize: 14 }}>No routes assigned to this vehicle yet.</Text>
          </Card>
        ) : (
          data ? inCycleOrder(data.routes).map((route) => <RouteCard key={`${route.id}-${previous}`} route={route} serverToday={data.today}
            date={route.shift === "EVENING" ? previous ? data.previousEveningDate : data.eveningDate : previous ? data.previousCycleDate : data.cycleDate} />) : null
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
