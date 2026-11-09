import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { DriverDuesCustomer, DriverDuesResponse } from "@shared/driver-api-types";
import { api, ApiError } from "@/api";
import { CollectPaymentModal } from "@/components/CollectPaymentModal";
import { getPaidToday, markPaidToday } from "@/payments-today";
import { recordOrQueuePayment } from "@/record-payment";
import { loadUpi, saveUpi } from "@/upi-cache";
import { Card, PrimaryButton, useColors } from "@/ui";

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
  const { customerId, routeId: routeIdParam, name: nameParam, code: codeParam, outstanding: outstandingParam } =
    useLocalSearchParams<{ customerId: string; routeId?: string; name?: string; code?: string; outstanding?: string }>();

  const [customer, setCustomer] = useState<DriverDuesCustomer | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [upi, setUpi] = useState<DriverDuesResponse["upi"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [collectOpen, setCollectOpen] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [paidToday, setPaidToday] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // True when the dues list could not be loaded and only what the delivery card
  // passed in is available — enough to collect, not enough to list bills.
  const [partial, setPartial] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const dues = await api.dues();
      const route = dues.routes.find((entry) => entry.customers.some((row) => row.customerId === customerId));
      const found = route?.customers.find((row) => row.customerId === customerId);
      if (!route || !found) {
        setError("This customer no longer has pending dues.");
        return;
      }
      setCustomer(found);
      setRouteId(route.routeId);
      if (dues.upi) void saveUpi(dues.upi);
      // A server that doesn't send the payee yet must not turn this into
      // cash-only: fall back to the copy the app remembered.
      setUpi(dues.upi ?? (await loadUpi()));
      setPartial(false);
      setPaidToday((await getPaidToday()).has(found.customerId));
    } catch (err) {
      // No signal (or the list is unavailable) but we arrived from a delivery
      // card that told us who this is: still allow collecting.
      if (routeIdParam && nameParam && Number(outstandingParam) > 0) {
        setCustomer({
          customerId,
          customerCode: codeParam ?? "",
          customerName: nameParam,
          mobile: null,
          sequenceNo: null,
          totalOutstanding: String(Number(outstandingParam)),
          bills: [],
        });
        setRouteId(routeIdParam);
        setUpi(await loadUpi());
        setPartial(true);
        setPaidToday((await getPaidToday()).has(customerId));
        return;
      }
      setError(err instanceof ApiError ? err.message : "Couldn't load this customer's dues.");
    }
  }, [customerId, routeIdParam, nameParam, codeParam, outstandingParam]);

  useEffect(() => {
    load();
  }, [load]);

  const collect = async (amount: number, mode: "CASH" | "UPI") => {
    if (!customer || !routeId || collecting) return;
    setCollecting(true);
    try {
      const { queued } = await recordOrQueuePayment({
        routeId,
        customerId: customer.customerId,
        customerName: customer.customerName,
        amount,
        mode,
      });
      await markPaidToday(customer.customerId);
      setPaidToday(true);
      setCollectOpen(false);
      setNotice(`₹${Math.round(amount)} ${mode === "CASH" ? "cash" : "UPI"} recorded${queued ? " (offline, will sync)" : ""}`);
    } catch (err) {
      setCollectOpen(false);
      setError(err instanceof ApiError ? err.message : "Couldn't record the payment.");
    } finally {
      setCollecting(false);
    }
  };

  // A payment is already on record for this customer today and it stays
  // "pending" until the office verifies it, so the amount above has not moved.
  // Make recording a second one a deliberate choice, not an easy double-tap.
  const startCollect = () => {
    if (!paidToday) {
      setCollectOpen(true);
      return;
    }
    Alert.alert(
      "Payment already recorded",
      `You already recorded a payment for ${customer?.customerName ?? "this customer"} today. It is waiting for the office to verify, so the pending amount hasn't changed. Record another payment?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Record another", onPress: () => setCollectOpen(true) },
      ],
    );
  };

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

            <View style={{ marginBottom: 16 }}>
              {notice ? (
                <Text style={{ color: colors.delivered, fontSize: 13.5, fontWeight: "700", marginBottom: 10 }}>{notice}</Text>
              ) : paidToday ? (
                <Text style={{ color: colors.inkSoft, fontSize: 13, marginBottom: 10 }}>
                  A payment was recorded today. It is waiting for the office to verify.
                </Text>
              ) : null}
              <PrimaryButton
                label={paidToday ? "Collect another payment" : "Collect payment"}
                onPress={startCollect}
                disabled={!routeId || collecting}
              />
            </View>

            <Text style={{ color: colors.inkFaint, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 8, marginLeft: 4 }}>
              {partial ? "Unpaid bills" : `${customer.bills.length} unpaid bill${customer.bills.length === 1 ? "" : "s"}`}
            </Text>
            {partial ? (
              <Card>
                <Text style={{ color: colors.inkSoft, fontSize: 13.5 }}>
                  The bill list needs a connection. You can still collect the payment above.
                </Text>
              </Card>
            ) : null}
            {!partial ? (
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
            ) : null}
          </>
        )}
      </ScrollView>

      {customer ? (
        <CollectPaymentModal
          visible={collectOpen}
          onClose={() => setCollectOpen(false)}
          customer={{ name: customer.customerName, customerCode: customer.customerCode, outstanding: Number(customer.totalOutstanding) }}
          upi={upi ?? null}
          saving={collecting}
          onCollect={(amount, mode) => void collect(amount, mode)}
        />
      ) : null}
    </SafeAreaView>
  );
}
