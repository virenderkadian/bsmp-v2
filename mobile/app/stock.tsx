import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { DriverStockResponse } from "@shared/driver-api-types";
import { useMorningStarted } from "@/active-route";
import { StockPanel } from "@/components/StockPanel";
import { expectedCashSummary } from "@/stock-expected";
import { radius } from "@/theme";
import { useColors } from "@/ui";

export default function StockScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [stock, setStock] = useState<DriverStockResponse | null>(null);

  // The stock list below already loads the stock; the amount on the link is
  // worked out from that same data, so opening this page makes no extra request.
  // The expected-cash figure itself is only fetched when the driver opens that
  // screen.
  const morningStarted = useMorningStarted() === true;
  const cash = stock && stock.products.length > 0 && stock.products.every((product) => product.rate !== undefined) ? expectedCashSummary(stock) : null;

  // The amount is only shown once the morning round is under way, when it means
  // something; before that the link is just a way in.
  const showAmount = morningStarted && cash !== null;

  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 }}>
      <Pressable onPress={() => router.back()}
        style={{ width: 36, height: 36, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="chevron-back" size={20} color={colors.ink} />
      </Pressable>
      <Text style={{ flex: 1, color: colors.ink, fontSize: 17, fontWeight: "800" }}>Vehicle stock</Text>
      {/* The way to Expected cash, as a small button instead of a card of its
          own. Shows the amount once the morning round is under way. */}
      <Pressable onPress={() => router.push("/expected-cash" as never)} accessibilityLabel="Expected cash"
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.brandTint, opacity: pressed ? 0.7 : 1 })}>
        <Ionicons name="cash-outline" size={18} color={colors.brand} />
        <Text style={{ color: colors.brand, fontSize: 13.5, fontWeight: "800" }}>
          {showAmount ? `${cash.net < 0 ? "−" : ""}₹${Math.abs(Math.round(cash.net)).toLocaleString("en-IN")}` : "Expected cash"}
        </Text>
        <Ionicons name="chevron-forward" size={14} color={colors.brand} />
      </Pressable>
    </View>
    <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 24 + insets.bottom }} keyboardShouldPersistTaps="handled">
      <StockPanel onStock={setStock} />
    </ScrollView>
  </SafeAreaView>;
}
