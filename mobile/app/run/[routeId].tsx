import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { DriverSheetCustomer, DriverSheetResponse } from "@shared/driver-api-types";
import { api, ApiError } from "@/api";
import { Card, Chip, ProgressBar, useColors } from "@/ui";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function statusOf(customer: DriverSheetCustomer): { tone: "delivered" | "skipped" | "pending"; label: string } {
  if (!customer.saved) return { tone: "pending", label: "Pending" };
  return customer.skipped ? { tone: "skipped", label: "Skipped" } : { tone: "delivered", label: "Delivered" };
}

export default function RunScreen() {
  const colors = useColors();
  const router = useRouter();
  const { routeId } = useLocalSearchParams<{ routeId: string }>();
  const [sheet, setSheet] = useState<DriverSheetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!routeId) return;
    try {
      setError(null);
      const result = await api.sheet(routeId, todayStr());
      setSheet(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load this route.");
    }
  }, [routeId]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const total = sheet?.customers.length ?? 0;
  const done = sheet?.customers.filter((customer) => customer.saved).length ?? 0;

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
            {sheet ? `${sheet.route.code} · ${sheet.route.name}` : "Loading…"}
          </Text>
          {sheet ? <Text style={{ color: colors.inkFaint, fontSize: 12 }}>{done} of {total} done</Text> : null}
        </View>
      </View>

      {sheet && total > 0 ? (
        <View style={{ paddingHorizontal: 18, paddingBottom: 10 }}>
          <ProgressBar value={total === 0 ? 0 : done / total} />
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={{ padding: 18, paddingTop: 4, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      >
        {error ? (
          <Card>
            <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text>
          </Card>
        ) : !sheet ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />
        ) : sheet.customers.length === 0 ? (
          <Card>
            <Text style={{ color: colors.inkSoft, fontSize: 14 }}>No customers on this route's sequence for the month.</Text>
          </Card>
        ) : (
          sheet.customers.map((customer) => {
            const status = statusOf(customer);
            const summary = customer.products.map((product) => `${product.code} ${product.deliveredQty}`).join(" · ");
            return (
              <Card key={customer.customerId} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "700" }}>
                      {customer.sequenceNo}. {customer.name}
                    </Text>
                    {customer.area ? <Text style={{ color: colors.inkFaint, fontSize: 12.5 }}>{customer.area}</Text> : null}
                    {summary ? <Text style={{ color: colors.inkSoft, fontSize: 12.5, marginTop: 4 }}>{summary}</Text> : null}
                  </View>
                  <Chip label={status.label} tone={status.tone} />
                </View>
              </Card>
            );
          })
        )}

        <Text style={{ color: colors.inkFaint, fontSize: 12.5, textAlign: "center", marginTop: 16 }}>
          Interactive stop-by-stop marking (slide to deliver / skip) is coming next.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
