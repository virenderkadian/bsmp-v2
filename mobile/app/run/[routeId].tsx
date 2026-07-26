import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { DriverSheetCustomer, DriverSheetResponse } from "@shared/driver-api-types";
import { useActiveRoute } from "@/active-route";
import { api, ApiError } from "@/api";
import { SlideToConfirm } from "@/components/SlideToConfirm";
import { Stepper } from "@/components/Stepper";
import { todayStr } from "@/route-progress";
import { radius } from "@/theme";
import { Card, Chip, PrimaryButton, ProgressBar, useColors } from "@/ui";

function statusOf(customer: DriverSheetCustomer): { tone: "delivered" | "skipped" | "pending"; label: string } {
  if (!customer.saved) return { tone: "pending", label: "Pending" };
  return customer.skipped ? { tone: "skipped", label: "Skipped" } : { tone: "delivered", label: "Delivered" };
}

export default function RunScreen() {
  const colors = useColors();
  const router = useRouter();
  const { routeId } = useLocalSearchParams<{ routeId: string }>();
  const { refresh: refreshActiveRoute } = useActiveRoute();

  const [sheet, setSheet] = useState<DriverSheetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [draftQty, setDraftQty] = useState<Record<string, number>>({});
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<{ index: number; label: string } | null>(null);

  const load = useCallback(async () => {
    if (!routeId) return;
    try {
      setError(null);
      const result = await api.sheet(routeId, todayStr());
      setSheet(result);
      const firstPending = result.customers.findIndex((customer) => !customer.saved);
      setCursor(firstPending >= 0 ? firstPending : 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load this route.");
    }
  }, [routeId]);

  useEffect(() => {
    load();
  }, [load]);

  const customer = sheet?.customers[cursor];
  const custId = customer?.customerId;

  // Reset the editable draft whenever we move to a different stop.
  useEffect(() => {
    if (!customer) return;
    const next: Record<string, number> = {};
    customer.products.forEach((product) => {
      next[product.productId] = Number(product.deliveredQty) || 0;
    });
    setDraftQty(next);
    setRemarks(customer.remarks ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custId]);

  // Auto-hide the undo snackbar.
  useEffect(() => {
    if (!snackbar) return;
    const timer = setTimeout(() => setSnackbar(null), 5000);
    return () => clearTimeout(timer);
  }, [snackbar]);

  const total = sheet?.customers.length ?? 0;
  const done = sheet?.customers.filter((entry) => entry.saved).length ?? 0;
  const allDone = total > 0 && done === total;

  const advance = () => {
    if (!sheet) return;
    const after = sheet.customers.findIndex((entry, index) => index > cursor && !entry.saved);
    if (after >= 0) {
      setCursor(after);
      return;
    }
    const anyPending = sheet.customers.findIndex((entry) => !entry.saved);
    setCursor(anyPending >= 0 ? anyPending : cursor);
  };

  const doSave = async (skipped: boolean) => {
    if (!customer || !sheet || !routeId || saving) return;
    setSaving(true);
    try {
      const products = customer.products.map((product) => ({
        productId: product.productId,
        quantity: draftQty[product.productId] ?? 0,
        rateSnapshot: Number(product.rate),
      }));
      const result = await api.saveLine(routeId, customer.customerId, {
        date: todayStr(),
        skipped,
        remarks: remarks.trim() || undefined,
        products,
      });
      setSheet((prev) =>
        prev
          ? { ...prev, customers: prev.customers.map((entry) => (entry.customerId === result.saved.customerId ? result.saved : entry)) }
          : prev,
      );
      setSnackbar({ index: cursor, label: skipped ? "Skipped" : "Delivered" });
      advance();
      // Progress just changed (and may have just hit 100%) — let the pill and
      // the route-start guard pick that up without waiting for their poll.
      refreshActiveRoute();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <>
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
          {sheet ? (
            <Text style={{ color: colors.inkFaint, fontSize: 12 }}>
              {allDone ? `${total} stops done` : customer ? `Stop ${cursor + 1} of ${total}` : `${done} of ${total} done`}
            </Text>
          ) : null}
        </View>
      </View>
      {sheet && total > 0 ? (
        <View style={{ paddingHorizontal: 18, paddingBottom: 10 }}>
          <ProgressBar value={total === 0 ? 0 : done / total} />
        </View>
      ) : null}
    </>
  );

  if (error && !sheet) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
        {header}
        <View style={{ padding: 18 }}>
          <Card>
            <Text style={{ color: colors.danger, fontSize: 14, marginBottom: 12 }}>{error}</Text>
            <PrimaryButton label="Retry" onPress={load} />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  if (!sheet) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
        {header}
        <ActivityIndicator color={colors.brand} style={{ marginTop: 30 }} />
      </SafeAreaView>
    );
  }

  // Round complete
  if (allDone || !customer) {
    const delivered = sheet.customers.filter((entry) => entry.saved && !entry.skipped).length;
    const skipped = sheet.customers.filter((entry) => entry.saved && entry.skipped).length;
    const totals = new Map<string, { qty: number; unit: string }>();
    sheet.customers.forEach((entry) => {
      if (entry.skipped) return;
      entry.products.forEach((product) => {
        const qty = Number(product.deliveredQty) || 0;
        if (qty <= 0) return;
        const current = totals.get(product.code) ?? { qty: 0, unit: product.unit };
        current.qty += qty;
        totals.set(product.code, current);
      });
    });
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
        {header}
        <ScrollView contentContainerStyle={{ padding: 18 }}>
          <View style={{ alignItems: "center", paddingVertical: 12 }}>
            <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: colors.deliveredTint, alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
              <Text style={{ color: colors.delivered, fontSize: 30, fontWeight: "800" }}>✓</Text>
            </View>
            <Text style={{ color: colors.ink, fontSize: 22, fontWeight: "800" }}>Round complete</Text>
            <Text style={{ color: colors.inkSoft, fontSize: 14, marginTop: 2 }}>{sheet.route.code} · {sheet.route.name}</Text>
          </View>
          <Card style={{ marginBottom: 12 }}>
            <Row label="Delivered" value={String(delivered)} color={colors.delivered} colors={colors} />
            <Row label="Skipped" value={String(skipped)} color={colors.skipped} colors={colors} last />
          </Card>
          {totals.size > 0 ? (
            <Card style={{ marginBottom: 16 }}>
              {[...totals.entries()].map(([code, info], index, arr) => (
                <Row key={code} label={code} value={`${info.qty} ${info.unit}`} colors={colors} last={index === arr.length - 1} />
              ))}
            </Card>
          ) : null}
          <PrimaryButton label="Back to routes" onPress={() => router.back()} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const status = statusOf(customer);
  const stopTotal = customer.products.reduce((sum, product) => sum + (draftQty[product.productId] ?? 0) * Number(product.rate), 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
      {header}
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Chip label={status.label} tone={status.tone} />
              <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "800", marginTop: 9 }}>
                {customer.sequenceNo}. {customer.name}
              </Text>
              {customer.area ? <Text style={{ color: colors.inkSoft, fontSize: 13.5, marginTop: 2 }}>{customer.area}</Text> : null}
            </View>
            {customer.mobile ? (
              <Pressable
                onPress={() => Linking.openURL(`tel:${customer.mobile}`)}
                style={{ width: 42, height: 42, borderRadius: 13, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ color: colors.brand, fontSize: 18 }}>📞</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 14 }} />

          {customer.products.length === 0 ? (
            <Text style={{ color: colors.inkFaint, fontSize: 13 }}>No deliverables set for this customer.</Text>
          ) : (
            customer.products.map((product, index) => (
              <View
                key={product.productId}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: 11,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                }}
              >
                <View>
                  <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "700" }}>{product.shortName ?? product.code}</Text>
                  <Text style={{ color: colors.inkFaint, fontSize: 12.5 }}>₹ {product.rate} / {product.unit}</Text>
                </View>
                <Stepper value={draftQty[product.productId] ?? 0} onChange={(next) => setDraftQty((prev) => ({ ...prev, [product.productId]: next }))} />
              </View>
            ))
          )}

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14, paddingTop: 13, borderTopWidth: 1, borderTopColor: colors.borderStrong }}>
            <Text style={{ color: colors.inkSoft, fontSize: 13, fontWeight: "600" }}>Stop total</Text>
            <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "800" }}>₹ {Math.round(stopTotal)}</Text>
          </View>
        </Card>

        {/* Explicit navigation — separate from the slide controls, which
            always advance to the next PENDING stop after a save. These move
            freely between adjacent stops (including already-saved ones, to
            review or correct), one at a time. */}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
          <Pressable
            onPress={() => setCursor((current) => Math.max(0, current - 1))}
            disabled={cursor === 0}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: 13,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.borderStrong,
              backgroundColor: colors.surface,
              alignItems: "center",
              opacity: cursor === 0 ? 0.4 : pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: colors.ink, fontSize: 14, fontWeight: "700" }}>‹ Previous</Text>
          </Pressable>
          <Pressable
            onPress={() => setCursor((current) => Math.min(total - 1, current + 1))}
            disabled={cursor >= total - 1}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: 13,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.borderStrong,
              backgroundColor: colors.surface,
              alignItems: "center",
              opacity: cursor >= total - 1 ? 0.4 : pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: colors.ink, fontSize: 14, fontWeight: "700" }}>Next ›</Text>
          </Pressable>
        </View>

        <TextInput
          value={remarks}
          onChangeText={setRemarks}
          placeholder="Add a note (optional)"
          placeholderTextColor={colors.inkFaint}
          style={{ marginTop: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, color: colors.ink, fontSize: 14 }}
        />

        <View key={customer.customerId} style={{ marginTop: 14, gap: 10 }}>
          <SlideToConfirm direction="right" tone="delivered" label="Slide to deliver" disabled={saving} onConfirm={() => doSave(false)} />
          <SlideToConfirm direction="left" tone="skipped" label="Slide to skip" disabled={saving} onConfirm={() => doSave(true)} />
        </View>

        {error ? <Text style={{ color: colors.danger, fontSize: 13, marginTop: 12, textAlign: "center" }}>{error}</Text> : null}
      </ScrollView>

      {snackbar ? (
        <View style={{ position: "absolute", left: 18, right: 18, bottom: 24, flexDirection: "row", alignItems: "center", backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: 16 }}>
          <Text style={{ flex: 1, color: colors.ground, fontSize: 14, fontWeight: "600" }}>{snackbar.label} · stop {snackbar.index + 1}</Text>
          <Pressable
            onPress={() => {
              setCursor(snackbar.index);
              setSnackbar(null);
            }}
          >
            <Text style={{ color: colors.brand, fontSize: 14, fontWeight: "800" }}>UNDO</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  color,
  colors,
  last,
}: {
  label: string;
  value: string;
  color?: string;
  colors: ReturnType<typeof useColors>;
  last?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      <Text style={{ color: colors.inkSoft, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: color ?? colors.ink, fontSize: 15, fontWeight: "800" }}>{value}</Text>
    </View>
  );
}
