import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { DriverDuesResponse, DriverRoute } from "@shared/driver-api-types";
import { api, ApiError } from "@/api";
import { TAB_BAR_HEIGHT } from "@/components/ActiveRoutePill";
import { RouteCard } from "@/route-card";
import { useSession } from "@/session";
import { Card, Chip, Eyebrow, ScreenTitle, useColors } from "@/ui";

function formatRupees(value: string): string {
  return `₹${Math.round(Number(value)).toLocaleString("en-IN")}`;
}

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { vehicle } = useSession();
  const [routes, setRoutes] = useState<DriverRoute[] | null>(null);
  const [dues, setDues] = useState<DriverDuesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [result, duesResult] = await Promise.all([api.routes(), api.dues()]);
      setRoutes(result.routes);
      setDues(duesResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your dashboard.");
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

  const today = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={{ padding: 18, paddingBottom: 24 + insets.bottom + TAB_BAR_HEIGHT }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <View>
            <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{today}</Text>
            <Text style={{ color: colors.ink, fontSize: 23, fontWeight: "800", letterSpacing: -0.4 }}>Dashboard</Text>
          </View>
          {vehicle ? <Chip label={`${vehicle.code} · ${vehicle.name}`} tone="brand" /> : null}
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
          <Card style={{ flex: 1 }}>
            <Text style={{ color: colors.inkFaint, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>Routes today</Text>
            <Text style={{ color: colors.ink, fontSize: 23, fontWeight: "800", marginTop: 4 }}>{routes ? routes.length : "—"}</Text>
          </Card>
          <Pressable
            style={{ flex: 1 }}
            disabled={!dues || dues.customerCount === 0}
            onPress={() => router.push("/dues")}
          >
            <Card>
              <Text style={{ color: colors.inkFaint, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>Pending dues</Text>
              {dues ? (
                dues.customerCount > 0 ? (
                  <>
                    <Text style={{ color: colors.danger, fontSize: 23, fontWeight: "800", marginTop: 4 }}>
                      {formatRupees(dues.grandTotalOutstanding)}
                    </Text>
                    <Text style={{ color: colors.inkSoft, fontSize: 12, marginTop: 2 }}>
                      {dues.customerCount} customer{dues.customerCount === 1 ? "" : "s"}
                    </Text>
                  </>
                ) : (
                  <Text style={{ color: colors.inkSoft, fontSize: 14, fontWeight: "600", marginTop: 8 }}>All clear</Text>
                )
              ) : (
                <Text style={{ color: colors.ink, fontSize: 23, fontWeight: "800", marginTop: 4 }}>—</Text>
              )}
            </Card>
          </Pressable>
        </View>

        {error ? (
          <Card style={{ marginBottom: 12 }}>
            <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text>
          </Card>
        ) : null}

        <Eyebrow>Your routes</Eyebrow>
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
