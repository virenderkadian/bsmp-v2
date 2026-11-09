import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { DriverDuesResponse, DriverRoutesResponse, DriverStockResponse } from "@shared/driver-api-types";
import { expectedStock, expectedStockTotal } from "@/stock-expected";
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
      // Best effort: an older server without the stock API just hides the card.
      setStock(await api.stock().catch(() => null));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your dashboard.");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void api.routes().then(setRouteData).catch(() => undefined); }, 60_000);
    return () => clearInterval(timer);
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
            <Text style={{ color: colors.ink, fontSize: 23, fontWeight: "800", marginTop: 4 }}>{routeData ? routeData.routes.length : "—"}</Text>
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

        {stock && stock.products.length > 0 && stock.products.every((product) => product.rate !== undefined) ? (() => {
          const rows = stock.products.map((product) => ({ product, ...expectedStock(product) }));
          const gross = expectedStockTotal(stock.products);
          const deposited = Number(stock.depositedVerified) || 0;
          const total = Math.round((gross - deposited) * 100) / 100;
          const finalised = stock.complete;
          return (
            <>
              <Eyebrow>{finalised ? "To hand in (cash / online)" : "Still to account for"}</Eyebrow>
              <Card style={{ marginBottom: 18 }}>
                <Text style={{ color: total < 0 ? colors.danger : colors.ink, fontSize: 23, fontWeight: "800" }}>
                  {total < 0 ? "−" : ""}{formatRupees(String(Math.abs(total)))}
                </Text>
                <Text style={{ color: colors.inkSoft, fontSize: 12, marginTop: 2, marginBottom: 8 }}>
                  {finalised ? "Stock not delivered or returned, to be paid in cash or online."
                    : "Given − delivered − returned so far. Return what is left, or collect this amount."}
                </Text>
                {rows.map(({ product, qty, amount }) => (
                  <View key={product.id} style={{ flexDirection: "row", paddingVertical: 4 }}>
                    <Text style={{ flex: 1, color: colors.ink, fontSize: 14 }}>{product.name}</Text>
                    <Text style={{ color: qty < 0 ? colors.danger : colors.inkSoft, fontSize: 14 }}>
                      {qty} {product.unit} · {qty < 0 ? "−" : ""}{formatRupees(String(Math.abs(amount)))}
                    </Text>
                  </View>
                ))}
                {deposited > 0 ? (
                  <Text style={{ color: colors.inkSoft, fontSize: 12, marginTop: 6 }}>
                    {formatRupees(String(gross))} expected − {formatRupees(String(deposited))} already received
                  </Text>
                ) : null}
                {rows.some((row) => row.qty < 0) ? (
                  <Text style={{ color: colors.danger, fontSize: 12, marginTop: 6 }}>Negative means more was delivered or returned than given. Check the stock entries.</Text>
                ) : null}
              </Card>
            </>
          );
        })() : null}

        <Eyebrow>Quick actions</Eyebrow>
        <Card style={{ paddingVertical: 0, marginBottom: 18 }}>
          <Pressable onPress={() => router.push("/stock" as never)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 })}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "700" }}>Record stock</Text>
              <Text style={{ color: colors.inkFaint, fontSize: 12, marginTop: 2 }}>Taken, refills and returns</Text>
            </View>
            <Text style={{ color: colors.inkFaint, fontSize: 18 }}>›</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/(tabs)/delivery")}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", paddingVertical: 15, opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ flex: 1, color: colors.ink, fontSize: 15, fontWeight: "700" }}>View routes</Text>
            <Text style={{ color: colors.inkFaint, fontSize: 18 }}>›</Text>
          </Pressable>
        </Card>

        <Eyebrow>Your routes</Eyebrow>
        {!routeData && !error ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 20 }} />
        ) : routeData && routeData.routes.length === 0 ? (
          <Card>
            <Text style={{ color: colors.inkSoft, fontSize: 14 }}>No routes assigned to this vehicle yet.</Text>
          </Card>
        ) : (
          routeData?.routes.map((route) => <RouteCard key={route.id} route={route} serverToday={routeData.today}
            date={route.shift === "EVENING" ? routeData.eveningDate : routeData.cycleDate} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
