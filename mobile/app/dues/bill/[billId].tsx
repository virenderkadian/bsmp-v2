import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { DriverBillDetailResponse } from "@shared/driver-api-types";
import { api, ApiError } from "@/api";
import { Card, Chip, useColors } from "@/ui";

function formatRupees(value: string): string {
  return `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatQty(value: string): string {
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function formatMonth(month: string): string {
  const [year, monthPart] = month.split("-");
  return new Date(Date.UTC(Number(year), Number(monthPart) - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function LineRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 7 }}>
      <Text style={{ color: strong ? colors.ink : colors.inkSoft, fontSize: 14, fontWeight: strong ? "800" : "500" }}>{label}</Text>
      <Text style={{ color: strong ? colors.ink : colors.ink, fontSize: 14, fontWeight: strong ? "800" : "600" }}>{value}</Text>
    </View>
  );
}

export default function BillDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { billId } = useLocalSearchParams<{ billId: string }>();

  const [bill, setBill] = useState<DriverBillDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setBill(await api.billDetail(billId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load this bill.");
    }
  }, [billId]);

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
            {bill ? formatMonth(bill.month) : "Bill"}
          </Text>
          {bill ? (
            <Text style={{ color: colors.inkFaint, fontSize: 12 }}>
              {bill.customer.customerName} · {bill.customer.customerCode}
            </Text>
          ) : null}
        </View>
        {bill ? <Chip label={bill.status === "LOCKED" ? "Locked" : "Generated"} tone={bill.status === "LOCKED" ? "delivered" : "pending"} /> : null}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom }}>
        {error ? (
          <Card>
            <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text>
          </Card>
        ) : !bill ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 20 }} />
        ) : (
          <>
            <Card style={{ marginBottom: 16 }}>
              <LineRow label="Opening balance" value={formatRupees(bill.openingBalance)} />
              <LineRow label="This month's delivery" value={formatRupees(bill.deliveryAmount)} />
              <LineRow label="Paid" value={formatRupees(bill.paymentAmount)} />
              <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
              <LineRow label="Pending" value={formatRupees(bill.closingBalance)} strong />
            </Card>

            <Text style={{ color: colors.inkFaint, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 8, marginLeft: 4 }}>
              Items delivered
            </Text>
            {bill.items.length === 0 ? (
              <Card>
                <Text style={{ color: colors.inkSoft, fontSize: 14 }}>No deliveries recorded this month.</Text>
              </Card>
            ) : (
              <Card style={{ padding: 0 }}>
                {bill.items.map((item, index) => (
                  <View
                    key={item.productId}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingVertical: 12,
                      paddingHorizontal: 14,
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: colors.border,
                    }}
                  >
                    <Text style={{ flex: 1, color: colors.ink, fontSize: 14, fontWeight: "700" }} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={{ color: colors.inkSoft, fontSize: 13 }}>
                      {formatQty(item.totalQty)} {item.unit} × {formatRupees(item.averageRate)}
                    </Text>
                    <Text style={{ color: colors.ink, fontSize: 14, fontWeight: "800", minWidth: 70, textAlign: "right" }}>
                      {formatRupees(item.totalAmount)}
                    </Text>
                  </View>
                ))}
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
