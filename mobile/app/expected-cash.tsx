import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { DriverStockResponse } from "@shared/driver-api-types";
import { api, ApiError } from "@/api";
import { expectedCashSummary } from "@/stock-expected";
import { radius } from "@/theme";
import { Card, Chip, Eyebrow, useColors } from "@/ui";

function rupees(value: number): string {
  return `${value < 0 ? "−" : ""}₹${Math.round(Math.abs(value)).toLocaleString("en-IN")}`;
}

function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

const num = (value: string) => String(Number(value) || 0);

export default function ExpectedCashScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [stock, setStock] = useState<DriverStockResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setStock(await api.stock());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load stock.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const summary = stock ? expectedCashSummary(stock) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 }}>
        <Pressable onPress={() => router.back()}
          style={{ width: 36, height: 36, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.ink, fontSize: 20, marginTop: -2 }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "800" }}>Expected cash</Text>
          {stock ? <Text style={{ color: colors.inkFaint, fontSize: 12 }}>{shortDate(stock.eveningDate)} evening + {shortDate(stock.cycleDate)} morning</Text> : null}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 24 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}>
        {error ? <Card><Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text></Card> : null}
        {!stock && !error ? <ActivityIndicator color={colors.brand} style={{ marginTop: 20 }} /> : null}
        {stock && stock.products.length === 0 ? <Card><Text style={{ color: colors.inkSoft, fontSize: 14 }}>No products are set up for stock reconciliation.</Text></Card> : null}
        {summary && stock && stock.products.length > 0 ? (
          <>
            <Card style={{ marginBottom: 18 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: colors.inkFaint, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>
                  {summary.finalised ? "To hand in" : "Still to account for"}
                </Text>
                <Chip label={summary.finalised ? "Final return done" : "Return pending"} tone={summary.finalised ? "delivered" : "pending"} />
              </View>
              <Text style={{ color: summary.net < 0 ? colors.danger : colors.ink, fontSize: 32, fontWeight: "800", marginTop: 6 }}>{rupees(summary.net)}</Text>
              <Text style={{ color: colors.inkSoft, fontSize: 13, marginTop: 4 }}>
                {summary.finalised
                  ? "Stock neither delivered nor returned. Pay this in cash or online."
                  : "Given − delivered − returned so far. Return what is left, or collect this amount in cash or online."}
              </Text>
              {summary.deposited > 0 ? (
                <Text style={{ color: colors.inkSoft, fontSize: 13, marginTop: 8 }}>
                  {rupees(summary.gross)} expected − {rupees(summary.deposited)} already received
                </Text>
              ) : null}
              {summary.hasShortage ? (
                <Text style={{ color: colors.danger, fontSize: 13, marginTop: 8 }}>
                  A negative product means more was delivered or returned than was given. Check the stock entries.
                </Text>
              ) : null}
            </Card>

            <Eyebrow>By product</Eyebrow>
            {summary.rows.length === 0 ? (
              <Card><Text style={{ color: colors.inkSoft, fontSize: 14 }}>Nothing left to account for on any product.</Text></Card>
            ) : null}
            {summary.rows.map(({ product, qty, amount }) => (
              <Card key={product.id} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                  <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "700" }}>{product.name}</Text>
                  <Text style={{ color: qty < 0 ? colors.danger : colors.ink, fontSize: 15, fontWeight: "800" }}>{rupees(amount)}</Text>
                </View>
                <Text style={{ color: qty < 0 ? colors.danger : colors.inkSoft, fontSize: 13, marginTop: 2 }}>
                  {qty} {product.unit} left at ₹{num(product.rate)}/{product.unit}
                </Text>
                <View style={{ marginTop: 8, gap: 3 }}>
                  {([
                    ["Given", product.given, ""],
                    ["Evening delivered", product.eveningSold, "−"],
                    ["Morning delivered", product.morningSold, "−"],
                    ["Returned", product.returned, "−"],
                  ] as const).map(([label, value, sign]) => (
                    <View key={label} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ color: colors.inkFaint, fontSize: 13 }}>{label}</Text>
                      <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{sign} {num(value)} {product.unit}</Text>
                    </View>
                  ))}
                </View>
              </Card>
            ))}

            <Pressable onPress={() => router.push("/stock" as never)}
              style={({ pressed }) => ({ marginTop: 6, paddingVertical: 14, alignItems: "center", opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ color: colors.brand, fontSize: 15, fontWeight: "700" }}>Record stock</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
