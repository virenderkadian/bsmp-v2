import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { DriverDuesResponse, DriverRoutesResponse, DriverStockResponse } from "@shared/driver-api-types";
import { expectedCashSummary } from "@/stock-expected";
import { api, ApiError } from "@/api";
import { useMorningStarted } from "@/active-route";
import { TAB_BAR_HEIGHT } from "@/components/ActiveRoutePill";
import { RouteCard } from "@/route-card";
import { inCycleOrder } from "@/route-progress";
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
  const [routeData, setRouteData] = useState<DriverRoutesResponse | null>(null);
  const [dues, setDues] = useState<DriverDuesResponse | null>(null);
  const [stock, setStock] = useState<DriverStockResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [result, duesResult] = await Promise.all([api.routes(), api.dues()]);
      setRouteData(result);
      setDues(duesResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your dashboard.");
    }
  }, []);

  // The expected-cash tile only appears once the morning route has started, so
  // its figures are only fetched then — not on every dashboard load before it.
  // Best effort: an older server without the stock API just hides the tile.
  const morningStarted = useMorningStarted() === true;
  const loadStock = useCallback(() => {
    if (!morningStarted) return;
    void api.stock().then(setStock).catch(() => setStock(null));
  }, [morningStarted]);
  useEffect(loadStock, [loadStock]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void api.routes().then(setRouteData).catch(() => undefined); }, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    loadStock();
    await load();
    setRefreshing(false);
  }, [load, loadStock]);

  const cash = stock && stock.products.length > 0 && stock.products.every((product) => product.rate !== undefined) ? expectedCashSummary(stock) : null;
  const today = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={{ padding: 18, paddingBottom: 24 + insets.bottom + TAB_BAR_HEIGHT }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      >
        {/* The vehicle is what this screen is about; the tab already says
            "Dashboard", so it does not need to say it again. */}
        <View style={{ marginBottom: 14 }}>
          <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{today}{vehicle ? ` · ${vehicle.code}` : ""}</Text>
          <Text style={{ color: colors.ink, fontSize: 23, fontWeight: "800", letterSpacing: -0.4 }} numberOfLines={1}>
            {vehicle ? vehicle.name : "Dashboard"}
          </Text>
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
          {!morningStarted ? (
            // Before the morning round has started there are no morning sales,
            // so almost everything given to the vehicle would read as "left".
            // The figure only means something once the round is under way.
            <Card style={{ flex: 1 }}>
              <Text style={{ color: colors.inkFaint, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>Routes today</Text>
              <Text style={{ color: colors.ink, fontSize: 23, fontWeight: "800", marginTop: 4 }}>{routeData ? routeData.routes.length : "—"}</Text>
            </Card>
          ) : (
          <Pressable style={{ flex: 1 }} disabled={!cash} onPress={() => router.push("/expected-cash" as never)}>
            <Card>
              <Text style={{ color: colors.inkFaint, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>Expected cash</Text>
              <Text style={{ color: cash && cash.net < 0 ? colors.danger : colors.ink, fontSize: 23, fontWeight: "800", marginTop: 4 }}>
                {cash ? `${cash.net < 0 ? "−" : ""}${formatRupees(String(Math.abs(cash.net)))}` : "—"}
              </Text>
              {cash ? <Text style={{ color: colors.inkSoft, fontSize: 12, marginTop: 2 }}>{cash.finalised ? "To hand in" : "Still to account for"}</Text> : null}
            </Card>
          </Pressable>
          )}
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

        <Pressable onPress={() => router.push("/stock" as never)} style={({ pressed }) => ({ marginBottom: 16, opacity: pressed ? 0.7 : 1 })}>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandTint, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="cube-outline" size={21} color={colors.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "800" }}>Record stock</Text>
              <Text style={{ color: colors.inkFaint, fontSize: 12.5, marginTop: 1 }}>Taken, refills and returns</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
          </Card>
        </Pressable>

        <Eyebrow>Routes</Eyebrow>
        {!routeData && !error ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 20 }} />
        ) : routeData && routeData.routes.length === 0 ? (
          <Card>
            <Text style={{ color: colors.inkSoft, fontSize: 14 }}>No routes assigned to this vehicle yet.</Text>
          </Card>
        ) : (
          routeData ? inCycleOrder(routeData.routes).map((route) => <RouteCard key={route.id} compact route={route} serverToday={routeData.today}
            date={route.shift === "EVENING" ? routeData.eveningDate : routeData.cycleDate} />) : null
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
