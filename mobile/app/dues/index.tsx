import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { DriverDuesResponse } from "@shared/driver-api-types";
import { api, ApiError } from "@/api";
import { Card, useColors } from "@/ui";

function formatRupees(value: string): string {
  return `₹${Math.round(Number(value)).toLocaleString("en-IN")}`;
}

// "2026-08" -> "Aug 2026"
function formatMonth(month: string): string {
  const [year, monthPart] = month.split("-");
  return new Date(Date.UTC(Number(year), Number(monthPart) - 1, 1)).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function DuesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [dues, setDues] = useState<DriverDuesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      setDues(await api.dues());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load pending dues.");
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

  const query = search.trim().toLowerCase();
  const visibleRoutes = useMemo(() => {
    if (!dues) return [];
    if (!query) return dues.routes;
    return dues.routes
      .map((route) => ({
        ...route,
        customers: route.customers.filter(
          (customer) =>
            customer.customerName.toLowerCase().includes(query) ||
            customer.customerCode.toLowerCase().includes(query),
        ),
      }))
      .filter((route) => route.customers.length > 0);
  }, [dues, query]);

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
            Pending dues
          </Text>
          {dues ? (
            <Text style={{ color: colors.inkFaint, fontSize: 12 }}>
              {formatRupees(dues.grandTotalOutstanding)} · {dues.customerCount} customer{dues.customerCount === 1 ? "" : "s"}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or code"
          placeholderTextColor={colors.inkFaint}
          style={{
            height: 44,
            borderRadius: 11,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
            paddingHorizontal: 14,
            color: colors.ink,
            fontSize: 14,
          }}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      >
        {error ? (
          <Card style={{ marginBottom: 12 }}>
            <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text>
          </Card>
        ) : null}

        {!dues && !error ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 20 }} />
        ) : dues && dues.customerCount === 0 ? (
          <Card>
            <Text style={{ color: colors.inkSoft, fontSize: 14 }}>No pending dues — every generated bill is settled.</Text>
          </Card>
        ) : dues && visibleRoutes.length === 0 ? (
          <Card>
            <Text style={{ color: colors.inkSoft, fontSize: 14 }}>No customers match "{search.trim()}".</Text>
          </Card>
        ) : (
          visibleRoutes.map((route) => (
            <View key={route.routeId} style={{ marginBottom: 18 }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8, paddingHorizontal: 4 }}>
                <Text style={{ color: colors.ink, fontSize: 14, fontWeight: "800" }}>
                  {route.routeCode} · {route.routeName}
                </Text>
                <Text style={{ color: colors.danger, fontSize: 13, fontWeight: "700" }}>{formatRupees(route.totalOutstanding)}</Text>
              </View>
              <Card style={{ padding: 0 }}>
                {route.customers.map((customer, index) => (
                  <Pressable
                    key={customer.customerId}
                    onPress={() => router.push(`/dues/customer/${customer.customerId}`)}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingVertical: 13,
                      paddingHorizontal: 14,
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: colors.border,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.ink, fontSize: 14.5, fontWeight: "700" }} numberOfLines={1}>
                        {customer.customerName}
                      </Text>
                      <Text style={{ color: colors.inkFaint, fontSize: 12, marginTop: 1 }}>
                        {customer.customerCode}
                        {customer.bills.length > 1
                          ? ` · ${customer.bills.length} months since ${formatMonth(customer.bills[0].month)}`
                          : ` · since ${formatMonth(customer.bills[0].month)}`}
                      </Text>
                    </View>
                    <Text style={{ color: colors.danger, fontSize: 15, fontWeight: "800" }}>
                      {formatRupees(customer.totalOutstanding)}
                    </Text>
                    <Text style={{ color: colors.inkFaint, fontSize: 16 }}>›</Text>
                  </Pressable>
                ))}
              </Card>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
