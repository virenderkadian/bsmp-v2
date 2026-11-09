import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { AdminVehiclePayment, DriverStockResponse } from "@shared/driver-api-types";
import { useMorningStarted } from "@/active-route";
import { AddVehiclePaymentModal } from "@/components/AddVehiclePaymentModal";
import { useSession } from "@/session";
import { api, ApiError } from "@/api";
import { expectedCashSummary } from "@/stock-expected";
import { radius } from "@/theme";
import { Card, Chip, Eyebrow, PrimaryButton, useColors } from "@/ui";

function rupees(value: number): string {
  return `${value < 0 ? "−" : ""}₹${Math.round(Math.abs(value)).toLocaleString("en-IN")}`;
}

function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

const num = (value: string) => String(Number(value) || 0);

// "LITRE" -> "L", "PCS" -> "pcs": the unit appears several times per card, and
// shouting it in capitals made the numbers harder to pick out.
function unitLabel(unit: string): string {
  const lower = unit.toLowerCase();
  return lower === "litre" || lower === "liter" ? "L" : lower;
}

export default function ExpectedCashScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [stock, setStock] = useState<DriverStockResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { admin, vehicle } = useSession();
  // Admin only: the deposits already recorded for this cycle, and the form to add one.
  const [payments, setPayments] = useState<AdminVehiclePayment[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const result = await api.stock();
      setStock(result);
      if (admin) {
        // Best effort: the figures above still stand if this list cannot load.
        setPayments((await api.adminVehiclePayments(result.cycleDate).catch(() => null))?.payments ?? []);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load stock.");
    }
  }, [admin]);
  useEffect(() => { void load(); }, [load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const morningStarted = useMorningStarted();
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
        {morningStarted === false && summary ? (
          // Shown, not withheld: the driver opened this on purpose. Just say why
          // the number is big, so nobody reads it as the final amount.
          <View style={{ marginBottom: 14, padding: 12, borderRadius: radius.md, backgroundColor: colors.skippedTint }}>
            <Text style={{ color: colors.skipped, fontSize: 13.5, lineHeight: 19, fontWeight: "600" }}>
              The morning route hasn't started, so no morning sales are counted yet. This amount will drop as deliveries are recorded.
            </Text>
          </View>
        ) : null}
        {!stock && !error ? <ActivityIndicator color={colors.brand} style={{ marginTop: 20 }} /> : null}
        {stock && stock.products.length === 0 ? <Card><Text style={{ color: colors.inkSoft, fontSize: 14 }}>No products are set up for stock reconciliation.</Text></Card> : null}
        {summary && stock && stock.products.length > 0 ? (
          <>
            {/* The headline is the one number to act on. The two lines under it
                show how it was reached, and only appear when something has
                already been received (otherwise they would just repeat it). */}
            <Card style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: colors.inkSoft, fontSize: 12, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" }}>
                  {summary.finalised ? "To hand in" : "Still to account for"}
                </Text>
                <Chip label={summary.finalised ? "Final return done" : "Return pending"} tone={summary.finalised ? "delivered" : "pending"} />
              </View>
              <Text style={{ color: summary.net < 0 ? colors.danger : colors.ink, fontSize: 38, fontWeight: "800", letterSpacing: -0.8, marginTop: 8 }}>
                {rupees(summary.net)}
              </Text>
              <Text style={{ color: colors.inkSoft, fontSize: 14, lineHeight: 20, marginTop: 6 }}>
                {summary.finalised
                  ? "Hand this amount in, in cash or online."
                  : "Return the stock that is left, or hand in this amount in cash or online."}
              </Text>
              {summary.deposited > 0 ? (
                <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderStrong, gap: 6 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: colors.inkSoft, fontSize: 14 }}>Stock left on the vehicle</Text>
                    <Text style={{ color: colors.ink, fontSize: 14, fontWeight: "700" }}>{rupees(summary.gross)}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: colors.inkSoft, fontSize: 14 }}>Already received</Text>
                    <Text style={{ color: colors.delivered, fontSize: 14, fontWeight: "700" }}>− {rupees(summary.deposited)}</Text>
                  </View>
                </View>
              ) : null}
              {summary.hasShortage ? (
                <View style={{ marginTop: 12, padding: 10, borderRadius: radius.sm, backgroundColor: colors.skippedTint }}>
                  <Text style={{ color: colors.danger, fontSize: 13, lineHeight: 18 }}>
                    A product below shows a negative amount: more was delivered or returned than was given. Check the stock entries.
                  </Text>
                </View>
              ) : null}
            </Card>

            {admin ? (
              <View style={{ marginBottom: 20 }}>
                <PrimaryButton label="Add payment" onPress={() => setAddOpen(true)} />
                {payments.length > 0 ? (
                  <View style={{ marginTop: 16 }}>
                    <Eyebrow>Payments received</Eyebrow>
                    <Card style={{ padding: 0 }}>
                      {payments.map((payment, index) => (
                        <View key={payment.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 14,
                          borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colors.border, opacity: payment.status === "CANCELLED" ? 0.5 : 1 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "800", textDecorationLine: payment.status === "CANCELLED" ? "line-through" : "none" }}>
                              {/* Exact, unlike the whole-rupee totals: a deposit of 1,500.50 must read as 1,500.50. */}
                              ₹{Number(payment.amount).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                            </Text>
                            <Text style={{ color: colors.inkSoft, fontSize: 12.5 }} numberOfLines={1}>
                              {{ CASH: "Cash", UPI: "UPI", BANK_TRANSFER: "Bank transfer", CHEQUE: "Cheque" }[payment.mode]}
                              {payment.referenceNo ? ` · ${payment.referenceNo}` : ""}
                              {payment.notes ? ` · ${payment.notes}` : ""}
                            </Text>
                          </View>
                          <Chip label={payment.status === "VERIFIED" ? "Received" : payment.status === "PENDING" ? "Pending" : "Cancelled"}
                            tone={payment.status === "VERIFIED" ? "delivered" : "pending"} />
                        </View>
                      ))}
                    </Card>
                  </View>
                ) : null}
              </View>
            ) : null}

            <Eyebrow>By product</Eyebrow>
            <Text style={{ color: colors.inkFaint, fontSize: 12.5, lineHeight: 18, marginBottom: 10, marginLeft: 4 }}>
              Left = given − evening − morning − returned
            </Text>
            {summary.rows.length === 0 ? (
              <Card><Text style={{ color: colors.inkSoft, fontSize: 14 }}>Nothing left to account for on any product.</Text></Card>
            ) : null}
            {summary.rows.map(({ product, qty, amount }) => {
              const unit = unitLabel(product.unit);
              const columns = [
                { label: "Given", value: num(product.given), minus: false },
                { label: "Evening", value: num(product.eveningSold), minus: true },
                { label: "Morning", value: num(product.morningSold), minus: true },
                { label: "Returned", value: num(product.returned), minus: true },
              ];
              return (
                <Card key={product.id} style={{ marginBottom: 12 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                    <Text style={{ flex: 1, color: colors.ink, fontSize: 17, fontWeight: "800" }} numberOfLines={1}>{product.name}</Text>
                    <Text style={{ color: qty < 0 ? colors.danger : colors.ink, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 }}>{rupees(amount)}</Text>
                  </View>
                  <Text style={{ color: qty < 0 ? colors.danger : colors.inkSoft, fontSize: 14, marginTop: 3 }}>
                    {qty} {unit} left · ₹{num(product.rate)} per {unit}
                  </Text>
                  <View style={{ flexDirection: "row", marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderStrong }}>
                    {columns.map((column) => (
                      <View key={column.label} style={{ flex: 1 }}>
                        <Text style={{ color: colors.inkFaint, fontSize: 11.5, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" }}>{column.label}</Text>
                        <Text style={{ color: column.value === "0" ? colors.inkFaint : colors.ink, fontSize: 17, fontWeight: "800", marginTop: 3 }}>
                          {column.minus && column.value !== "0" ? "− " : ""}{column.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                </Card>
              );
            })}

            <Pressable onPress={() => router.push("/stock" as never)}
              style={({ pressed }) => ({ marginTop: 6, paddingVertical: 14, alignItems: "center", opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ color: colors.brand, fontSize: 15, fontWeight: "700" }}>Record stock</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>

      {admin && stock ? (
        <AddVehiclePaymentModal
          visible={addOpen}
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); void load(); }}
          vehicleLabel={vehicle ? `${vehicle.code} · ${vehicle.name}` : "this vehicle"}
          cycleDate={stock.cycleDate}
          balance={summary ? Math.max(0, summary.net) : 0}
        />
      ) : null}
    </SafeAreaView>
  );
}
