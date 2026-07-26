import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { DriverSaveLineRequest, DriverSheetCustomer, DriverSheetResponse } from "@shared/driver-api-types";
import { useActiveRoute } from "@/active-route";
import { api, ApiError } from "@/api";
import { CashSaleModal } from "@/components/CashSaleModal";
import { RouteMapModal } from "@/components/RouteMapModal";
import { SlideToConfirm } from "@/components/SlideToConfirm";
import { Stepper } from "@/components/Stepper";
import { StopsListModal } from "@/components/StopsListModal";
import { openNavigation, resolveLocationForSave } from "@/location";
import { enqueueSave, getQueueForRoute } from "@/offline-queue";
import { useOfflineSync } from "@/offline-sync-context";
import { todayStr } from "@/route-progress";
import { isOnline } from "@/sync";
import { radius } from "@/theme";
import { Card, Chip, PrimaryButton, ProgressBar, useColors } from "@/ui";

function statusOf(customer: DriverSheetCustomer, isQueued: boolean): { tone: "delivered" | "skipped" | "pending"; label: string } {
  if (!customer.saved) return { tone: "pending", label: "Pending" };
  if (isQueued) return { tone: "pending", label: customer.skipped ? "Skipped · queued" : "Delivered · queued" };
  return customer.skipped ? { tone: "skipped", label: "Skipped" } : { tone: "delivered", label: "Delivered" };
}

// Mirrors what the server would compute for a save, so a queued (offline)
// delivery shows correctly in the UI immediately — sheet state is always the
// optimistic local truth regardless of whether the save has actually reached
// the server yet; the offline queue is purely "what still needs sending".
function buildOptimisticCustomer(
  customer: DriverSheetCustomer,
  skipped: boolean,
  remarks: string,
  products: Array<{ productId: string; quantity: number; rateSnapshot: number }>,
): DriverSheetCustomer {
  const byProduct = new Map(products.map((product) => [product.productId, product]));
  return {
    ...customer,
    saved: true,
    skipped,
    remarks: remarks.trim() || null,
    products: customer.products.map((product) => {
      const match = byProduct.get(product.productId);
      return match ? { ...product, deliveredQty: String(match.quantity) } : { ...product, deliveredQty: "0" };
    }),
  };
}

export default function RunScreen() {
  const colors = useColors();
  const router = useRouter();
  const { routeId } = useLocalSearchParams<{ routeId: string }>();
  const { refresh: refreshActiveRoute } = useActiveRoute();
  const { pendingCount, isOnline: online, syncing, syncNow } = useOfflineSync();

  const [sheet, setSheet] = useState<DriverSheetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [draftQty, setDraftQty] = useState<Record<string, number>>({});
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<{ index: number; label: string } | null>(null);
  // Which of THIS route's customers have a save sitting in the local offline
  // queue right now — display-only (sheet state is already the optimistic
  // source of truth for saved/skipped/quantities either way), used just to
  // label a stop "queued" instead of "Delivered" until it's actually synced.
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  // A saved stop opens read-only by default (see canEdit below) so browsing
  // with Prev/Next can't silently overwrite an already-recorded delivery;
  // this explicitly unlocks it. Resets whenever the viewed stop changes.
  const [editMode, setEditMode] = useState(false);
  // Lets the driver view the round summary from the last sequence stop even
  // if a few earlier ones are still pending (they went out of order) —
  // separate from allDone, which is the automatic "everything's actually done" case.
  const [manuallyFinished, setManuallyFinished] = useState(false);
  const [stopsListOpen, setStopsListOpen] = useState(false);
  const [cashSaleOpen, setCashSaleOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

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

  const refreshQueuedIds = useCallback(async () => {
    if (!routeId) return;
    const items = await getQueueForRoute(routeId);
    setQueuedIds(new Set(items.map((item) => item.customerId)));
  }, [routeId]);

  useEffect(() => {
    refreshQueuedIds();
    // Also re-check whenever the GLOBAL pending count changes — covers a
    // background auto-sync (triggered by the provider on reconnect/foreground)
    // completing while this screen happens to be open.
  }, [refreshQueuedIds, pendingCount]);

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
    setEditMode(false);
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
  const isLastStop = total > 0 && cursor === total - 1;
  const routeQueueCount = queuedIds.size;

  const finishRoute = () => {
    if (!sheet) return;
    const pendingStops = sheet.customers.filter((entry) => !entry.saved).length;
    if (pendingStops > 0) {
      Alert.alert(
        "Finish route?",
        `${pendingStops} stop${pendingStops === 1 ? "" : "s"} still pending. You can finish now and come back to ${pendingStops === 1 ? "it" : "them"} later.`,
        [
          { text: "Keep going", style: "cancel" },
          { text: "Finish anyway", style: "destructive", onPress: () => setManuallyFinished(true) },
        ],
      );
      return;
    }
    setManuallyFinished(true);
  };

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
      // A skip carries no deliverables — the backend already discards
      // products when skipped is true, so send none rather than whatever
      // happens to be sitting in the (irrelevant) quantity steppers.
      const products = skipped
        ? []
        : customer.products.map((product) => ({
            productId: product.productId,
            quantity: draftQty[product.productId] ?? 0,
            rateSnapshot: Number(product.rate),
          }));
      // GPS works fully offline — only the actual network save is
      // connectivity-sensitive, so location resolution always runs first.
      // Backfills silently if the customer has no saved location yet; if they
      // do and this fix is >12m off, prompts the driver before agreeing to
      // move it. Skipped visits never touch location at all.
      const locationFields = skipped ? {} : await resolveLocationForSave(customer.latitude, customer.longitude);
      const request: DriverSaveLineRequest = {
        date: todayStr(),
        skipped,
        remarks: remarks.trim() || undefined,
        products,
        ...locationFields,
      };

      let queued = false;
      if (await isOnline()) {
        try {
          const result = await api.saveLine(routeId, customer.customerId, request);
          setSheet((prev) =>
            prev
              ? { ...prev, customers: prev.customers.map((entry) => (entry.customerId === result.saved.customerId ? result.saved : entry)) }
              : prev,
          );
        } catch (err) {
          // status 0 = never reached the server (see api.ts) — a real
          // connectivity failure, worth queuing for later. Any other status
          // means the server responded and rejected it (e.g. bill locked) —
          // retrying later won't change that, so surface it now instead of
          // silently queuing a save that's certain to fail again.
          if (err instanceof ApiError && err.status !== 0) {
            throw err;
          }
          queued = true;
        }
      } else {
        queued = true;
      }

      if (queued) {
        await enqueueSave(routeId, customer.customerId, request);
        // Sheet is always the optimistic local truth regardless of sync
        // state — this is what lets total/done/advance/round-complete all
        // keep working unchanged whether a stop is confirmed or still queued.
        setSheet((prev) =>
          prev
            ? {
                ...prev,
                customers: prev.customers.map((entry) =>
                  entry.customerId === customer.customerId ? buildOptimisticCustomer(entry, skipped, remarks, products) : entry,
                ),
              }
            : prev,
        );
        refreshQueuedIds();
      }

      setSnackbar({ index: cursor, label: `${skipped ? "Skipped" : "Delivered"}${queued ? " (offline, will sync)" : ""}` });
      setEditMode(false); // freshly saved — lock again even if we don't move (e.g. last stop)
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
        {sheet ? (
          <Pressable
            onPress={() => setCashSaleOpen(true)}
            style={{ width: 36, height: 36, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ fontSize: 16 }}>💵</Text>
          </Pressable>
        ) : null}
        {sheet && total > 0 ? (
          <Pressable
            onPress={() => setMapOpen(true)}
            style={{ width: 36, height: 36, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ fontSize: 16 }}>🗺️</Text>
          </Pressable>
        ) : null}
        {sheet && total > 0 && !allDone && !manuallyFinished ? (
          <Pressable
            onPress={() => setStopsListOpen(true)}
            style={{ width: 36, height: 36, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: colors.ink, fontSize: 16 }}>☰</Text>
          </Pressable>
        ) : null}
      </View>
      {sheet && total > 0 ? (
        <View style={{ paddingHorizontal: 18, paddingBottom: 10 }}>
          <ProgressBar value={total === 0 ? 0 : done / total} />
        </View>
      ) : null}
      {routeQueueCount > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingBottom: 10 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: online ? colors.brand : colors.inkFaint }} />
          <Text style={{ flex: 1, color: colors.inkSoft, fontSize: 12 }}>
            {online
              ? `${routeQueueCount} stop${routeQueueCount === 1 ? "" : "s"} syncing…`
              : `${routeQueueCount} stop${routeQueueCount === 1 ? "" : "s"} waiting to sync (offline)`}
          </Text>
          <Pressable onPress={() => syncNow()} disabled={syncing || !online} hitSlop={6}>
            <Text style={{ color: colors.brand, fontSize: 12, fontWeight: "700", opacity: syncing || !online ? 0.4 : 1 }}>
              {syncing ? "Syncing…" : "Sync now"}
            </Text>
          </Pressable>
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
  if (allDone || manuallyFinished || !customer) {
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

        <CashSaleModal
          visible={cashSaleOpen}
          onClose={() => setCashSaleOpen(false)}
          routeId={sheet.route.id}
          products={sheet.customers[0]?.products ?? []}
        />

        <RouteMapModal
          visible={mapOpen}
          onClose={() => setMapOpen(false)}
          customers={sheet.customers}
          currentIndex={cursor}
          statusOf={(c) => statusOf(c, queuedIds.has(c.customerId))}
          onSelect={(index) => {
            setCursor(index);
            setManuallyFinished(false);
            setMapOpen(false);
          }}
        />
      </SafeAreaView>
    );
  }

  const status = statusOf(customer, queuedIds.has(customer.customerId));
  const stopTotal = customer.products.reduce((sum, product) => sum + (draftQty[product.productId] ?? 0) * Number(product.rate), 0);
  // A saved stop is read-only until explicitly unlocked, so browsing with
  // Prev/Next can't silently overwrite an already-recorded delivery.
  const canEdit = !customer.saved || editMode;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
      {header}
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Chip label={status.label} tone={status.tone} />
                {customer.saved && !editMode ? (
                  <Pressable onPress={() => setEditMode(true)} hitSlop={6}>
                    <Text style={{ color: colors.brand, fontSize: 12.5, fontWeight: "700" }}>Edit</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "800", marginTop: 9 }}>
                {customer.sequenceNo}. {customer.name}
              </Text>
              {customer.area ? <Text style={{ color: colors.inkSoft, fontSize: 13.5, marginTop: 2 }}>{customer.area}</Text> : null}
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {customer.latitude && customer.longitude ? (
                <Pressable
                  onPress={() => openNavigation(Number(customer.latitude), Number(customer.longitude))}
                  style={{ width: 42, height: 42, borderRadius: 13, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ fontSize: 18 }}>🧭</Text>
                </Pressable>
              ) : null}
              {customer.mobile ? (
                <Pressable
                  onPress={() => Linking.openURL(`tel:${customer.mobile}`)}
                  style={{ width: 42, height: 42, borderRadius: 13, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ color: colors.brand, fontSize: 18 }}>📞</Text>
                </Pressable>
              ) : null}
            </View>
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
                {canEdit ? (
                  <Stepper value={draftQty[product.productId] ?? 0} onChange={(next) => setDraftQty((prev) => ({ ...prev, [product.productId]: next }))} />
                ) : (
                  <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "800" }}>
                    {draftQty[product.productId] ?? 0} {product.unit}
                  </Text>
                )}
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

        {isLastStop ? (
          <Pressable
            onPress={finishRoute}
            style={({ pressed }) => ({
              marginTop: 10,
              paddingVertical: 13,
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: colors.brand,
              alignItems: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: colors.brand, fontSize: 14, fontWeight: "800" }}>Finish route</Text>
          </Pressable>
        ) : null}

        {canEdit || remarks.trim() ? (
          <TextInput
            value={remarks}
            onChangeText={setRemarks}
            editable={canEdit}
            placeholder="Add a note (optional)"
            placeholderTextColor={colors.inkFaint}
            style={{
              marginTop: 12,
              backgroundColor: canEdit ? colors.surface : colors.surface2,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: radius.md,
              paddingHorizontal: 14,
              paddingVertical: 12,
              color: canEdit ? colors.ink : colors.inkSoft,
              fontSize: 14,
            }}
          />
        ) : null}

        {canEdit ? (
          <View key={customer.customerId} style={{ marginTop: 14, gap: 10 }}>
            <SlideToConfirm direction="right" tone="delivered" label="Slide to deliver" disabled={saving} onConfirm={() => doSave(false)} />
            <SlideToConfirm direction="left" tone="skipped" label="Slide to skip" disabled={saving} onConfirm={() => doSave(true)} />
          </View>
        ) : (
          <Pressable
            onPress={() => setEditMode(true)}
            style={({ pressed }) => ({
              marginTop: 14,
              paddingVertical: 14,
              borderRadius: radius.md,
              backgroundColor: colors.surface2,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: colors.inkSoft, fontSize: 13.5, fontWeight: "700" }}>
              Recorded as {status.label.toLowerCase()} · tap to edit
            </Text>
          </Pressable>
        )}

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

      <StopsListModal
        visible={stopsListOpen}
        onClose={() => setStopsListOpen(false)}
        customers={sheet.customers}
        currentIndex={cursor}
        statusOf={(c) => statusOf(c, queuedIds.has(c.customerId))}
        onSelect={(index) => {
          setCursor(index);
          setStopsListOpen(false);
        }}
      />

      <CashSaleModal
        visible={cashSaleOpen}
        onClose={() => setCashSaleOpen(false)}
        routeId={sheet.route.id}
        products={sheet.customers[0]?.products ?? []}
      />

      <RouteMapModal
        visible={mapOpen}
        onClose={() => setMapOpen(false)}
        customers={sheet.customers}
        currentIndex={cursor}
        statusOf={(c) => statusOf(c, queuedIds.has(c.customerId))}
        onSelect={(index) => {
          setCursor(index);
          setMapOpen(false);
        }}
      />
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
