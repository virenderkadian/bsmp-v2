import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { DriverDuesCustomer } from "@shared/driver-api-types";
import { api, ApiError } from "@/api";
import { Card, useColors } from "@/ui";

function formatRupees(value: string): string {
  return `₹${Math.round(Number(value)).toLocaleString("en-IN")}`;
}

function formatMonth(month: string): string {
  const [year, monthPart] = month.split("-");
  return new Date(Date.UTC(Number(year), Number(monthPart) - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function CustomerDuesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { customerId } = useLocalSearchParams<{ customerId: string }>();

  const [customer, setCustomer] = useState<DriverDuesCustomer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const dues = await api.dues();
      const found = dues.routes.flatMap((route) => route.customers).find((row) => row.customerId === customerId);
      if (!found) {
        setError("This customer no longer has pending dues.");
        return;
      }
      setCustomer(found);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load this customer's dues.");
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 }}>
        <Pressable
          onPress={() => router.back()}
          style={{ width: 36, height: 36, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: colors.ink, fontSize: 20, marginTop: -2 }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "800" }} numberOfLines={1}>
            {customer ? customer.customerName : "Pending dues"}
          </Text>
          {customer ? <Text style={{ color: colors.inkFaint, fontSize: 12 }}>{customer.customerCode}</Text> : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom }}>
        {error ? (
          <Card>
            <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text>
          </Card>
        ) : !customer ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 20 }} />
        ) : (
          <>
            <Card style={{ marginBottom: 16 }}>
              <Text style={{ color: colors.inkFaint, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>
                Total pending
              </Text>
              <Text style={{ color: colors.danger, fontSize: 28, fontWeight: "800", marginTop: 4 }}>
                {formatRupees(customer.totalOutstanding)}
              </Text>
              {customer.mobile ? (
                <Pressable onPress={() => Linking.openURL(`tel:${customer.mobile}`)} style={{ marginTop: 10, alignSelf: "flex-start" }}>
                  <Text style={{ color: colors.brand, fontSize: 14, fontWeight: "700" }}>📞 Call {customer.mobile}</Text>
                </Pressable>
              ) : null}
            </Card>

            <Text style={{ color: colors.inkFaint, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 8, marginLeft: 4 }}>
              {customer.bills.length} unpaid bill{customer.bills.length === 1 ? "" : "s"}
            </Text>
            <Card style={{ padding: 0 }}>
              {customer.bills.map((bill, index) => (
                <Pressable
                  key={bill.billId}
                  onPress={() => router.push(`/dues/bill/${bill.billId}`)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingVertical: 14,
                    paddingHorizontal: 14,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: colors.border,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text style={{ flex: 1, color: colors.ink, fontSize: 14.5, fontWeight: "700" }}>{formatMonth(bill.month)}</Text>
                  <Text style={{ color: colors.danger, fontSize: 15, fontWeight: "800" }}>{formatRupees(bill.outstanding)}</Text>
                  <Text style={{ color: colors.inkFaint, fontSize: 16 }}>›</Text>
                </Pressable>
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
