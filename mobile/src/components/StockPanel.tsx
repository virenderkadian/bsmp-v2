import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { DriverStockAction, DriverStockProduct, DriverStockRequest, DriverStockResponse, RouteShift } from "@shared/driver-api-types";
import { api, ApiError } from "@/api";
import { CycleSwitch } from "@/components/CycleSwitch";
import { radius } from "@/theme";
import { Card, Chip, Eyebrow, PrimaryButton, useColors } from "@/ui";

const labels: Record<DriverStockAction, string> = {
  EVENING_TAKEN: "Stock taken", EVENING_REFILL: "Evening refill", EVENING_RETURN: "Return to fridge",
  MORNING_REFILL: "Morning refill", MORNING_RETURN: "Final return",
};

const actionCues: Record<DriverStockAction, { symbol: string; shortLabel: string; tone: "add" | "subtract" }> = {
  EVENING_TAKEN: { symbol: "+", shortLabel: "Taken", tone: "add" },
  EVENING_REFILL: { symbol: "+", shortLabel: "Refill", tone: "add" },
  EVENING_RETURN: { symbol: "−", shortLabel: "Fridge return", tone: "subtract" },
  MORNING_REFILL: { symbol: "+", shortLabel: "Refill", tone: "add" },
  MORNING_RETURN: { symbol: "−", shortLabel: "Final return", tone: "subtract" },
};

function displayDate(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

// `onStock` hands the loaded stock to a parent that wants to show something
// derived from it (e.g. a total), so the parent never needs a second request.
export function StockPanel({ compact = false, onSaved, onStock, cycleDate: requestedCycleDate, routeShift }: { compact?: boolean; onSaved?: () => void; onStock?: (stock: DriverStockResponse) => void; cycleDate?: string; routeShift?: RouteShift }) {
  const colors = useColors();
  const [stock, setStock] = useState<DriverStockResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ product: DriverStockProduct; action: DriverStockAction } | null>(null);
  const [quantity, setQuantity] = useState("");
  const [saving, setSaving] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [currentCycleDate, setCurrentCycleDate] = useState<string | null>(null);
  const [showPrevious, setShowPrevious] = useState(false);
  useEffect(() => { if (stock) onStock?.(stock); }, [stock, onStock]);

  const priorDate = currentCycleDate ? (() => { const day = new Date(`${currentCycleDate}T00:00:00Z`); day.setUTCDate(day.getUTCDate() - 1); return day.toISOString().slice(0, 10); })() : null;
  const viewedCycleDate = requestedCycleDate ?? (showPrevious ? priorDate ?? undefined : undefined);

  const load = useCallback(async () => {
    try {
      const result = await api.stock(viewedCycleDate);
      setStock(result);
      if (!showPrevious && !requestedCycleDate) setCurrentCycleDate(result.cycleDate);
      setError(null);
    }
    catch (cause) {
      setError(cause instanceof ApiError && cause.status === 404
        ? "Stock entry is not available on the connected server yet."
        : cause instanceof ApiError ? cause.message : "Could not load stock.");
    }
    finally { setLoading(false); }
  }, [viewedCycleDate, showPrevious, requestedCycleDate]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (requestedCycleDate) return;
    const timer = setInterval(() => {
      void api.stock().then((result) => {
        setCurrentCycleDate(result.cycleDate);
        if (!showPrevious) setStock(result);
      }).catch(() => undefined);
    }, 60_000);
    return () => clearInterval(timer);
  }, [requestedCycleDate, showPrevious]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const open = (product: DriverStockProduct, action: DriverStockAction) => {
    setSelection({ product, action }); setQuantity(""); setRequestId(null); setError(null);
  };
  const save = async () => {
    if (!stock || !selection || saving) return;
    if (!/^\d+(\.\d{1,3})?$/.test(quantity)) { setError("Enter a valid quantity, up to 3 decimal places."); return; }
    if (selection.action !== "MORNING_RETURN" && Number(quantity) <= 0) { setError("Enter an amount greater than zero."); return; }
    const id = requestId ?? Crypto.randomUUID();
    setRequestId(id); setSaving(true); setError(null);
    const body: DriverStockRequest = { requestId: id, cycleDate: stock.cycleDate, productId: selection.product.id, action: selection.action, quantity };
    try {
      setStock(await api.saveStock(body));
      setNotice(`${labels[selection.action]} saved · ${quantity} ${selection.product.unit}`);
      setSelection(null); setQuantity(""); setRequestId(null); onSaved?.();
    }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not save stock. Try again."); }
    finally { setSaving(false); }
  };

  if (loading) return <ActivityIndicator color={colors.brand} style={{ marginVertical: 20 }} />;
  const shiftClosed = routeShift !== undefined && stock !== null && stock.shift !== routeShift;
  const selectedCue = selection ? actionCues[selection.action] : null;
  const selectedToneColor = selectedCue?.tone === "add" ? colors.delivered : selectedCue?.tone === "subtract" ? colors.skipped : colors.brand;
  return <View>
    {!compact && !requestedCycleDate && currentCycleDate ? <CycleSwitch previous={showPrevious} onChange={(value) => { setLoading(true); setShowPrevious(value); }} /> : null}
    {stock ? <>
      {compact ? <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "800", letterSpacing: -0.3 }}>
            {stock.shift === "EVENING" ? "Evening" : "Morning"} stock
          </Text>
          <Text style={{ color: colors.inkFaint, fontSize: 12.5, marginTop: 1 }}>
            {displayDate(stock.eveningDate)} evening → {displayDate(stock.cycleDate)} morning
          </Text>
        </View>
        <Chip label={stock.complete ? "Completed" : !stock.editable || shiftClosed ? "View only" : "In progress"} tone={stock.complete ? "delivered" : !stock.editable || shiftClosed ? "pending" : "brand"} />
      </View> : <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        {/* One line: which stock this is, which cycle, and where it stands. */}
        <Text style={{ flex: 1, color: colors.inkSoft, fontSize: 13 }} numberOfLines={1}>
          <Text style={{ color: colors.ink, fontWeight: "800" }}>{stock.shift === "EVENING" ? "Evening" : "Morning"} stock</Text>
          {"  ·  "}{displayDate(stock.eveningDate)} → {displayDate(stock.cycleDate)}
        </Text>
        <Chip label={stock.complete ? "Completed" : !stock.editable || shiftClosed ? "View only" : "In progress"} tone={stock.complete ? "delivered" : !stock.editable || shiftClosed ? "pending" : "brand"} />
      </View>}
      {notice ? <View style={{ backgroundColor: colors.deliveredTint, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10 }}>
        <Text style={{ color: colors.delivered, fontSize: 13, fontWeight: "700" }}>✓ {notice}</Text>
      </View> : null}
      {stock.products.map((product) => {
        const actions: DriverStockAction[] = stock.shift === "EVENING"
          ? [
              ...(!product.eveningTakenRecorded ? ["EVENING_TAKEN" as const] : []),
              "EVENING_REFILL",
              ...(!product.eveningReturnRecorded ? ["EVENING_RETURN" as const] : []),
            ]
          : product.morningReturnRecorded ? [] : ["MORNING_REFILL", "MORNING_RETURN"];
        const num = (value: string | undefined) => String(Number(value) || 0);
        // Four small columns instead of two stacked rows of big ones: the same
        // figures in about a third of the height.
        const stats = [
          { label: "Given", value: num(product.given) },
          { label: "Evening", value: num(product.eveningSold) },
          { label: "Morning", value: num(product.morningSold) },
          { label: "Returned", value: product.morningReturnRecorded ? num(product.returned) : "—" },
        ];
        const hasActivity = stats.some((stat) => stat.value !== "0" && stat.value !== "—");
        return <Card key={product.id} style={{ marginBottom: 8, padding: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "800", flex: 1 }} numberOfLines={1}>
              {product.name} <Text style={{ color: colors.inkFaint, fontSize: 12, fontWeight: "600" }}>{product.unit.toLowerCase() === "litre" ? "L" : product.unit.toLowerCase()}</Text>
            </Text>
            {product.morningReturnRecorded ? <Chip label="Returned" tone="delivered" /> : null}
          </View>
          {hasActivity ? <View style={{ flexDirection: "row", marginTop: 8 }}>
            {stats.map((stat) => <View key={stat.label} style={{ flex: 1 }}>
              <Text style={{ color: colors.inkFaint, fontSize: 10.5, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 }}>{stat.label}</Text>
              <Text style={{ color: stat.value === "0" || stat.value === "—" ? colors.inkFaint : colors.ink, fontSize: 16, fontWeight: "800", marginTop: 1 }}>{stat.value}</Text>
            </View>)}
          </View> : null}
          {stock.editable && !shiftClosed && actions.length > 0 ? <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            {actions.map((action) => {
              const cue = actionCues[action];
              const foreground = cue.tone === "add" ? colors.delivered : cue.tone === "subtract" ? colors.skipped : colors.brand;
              const background = cue.tone === "add" ? colors.deliveredTint : cue.tone === "subtract" ? colors.skippedTint : colors.brandTint;
              return <Pressable key={action} onPress={() => open(product, action)}
                accessibilityRole="button"
                accessibilityLabel={`${labels[action]} for ${product.name}`}
                style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", minHeight: 40,
                  backgroundColor: background, borderRadius: radius.md, paddingHorizontal: 8, opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ color: foreground, fontSize: 16, fontWeight: "800", marginRight: 5 }}>{cue.symbol}</Text>
                <Text style={{ color: foreground, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>{cue.shortLabel}</Text>
              </Pressable>;
            })}
          </View> : null}
        </Card>;
      })}
      {stock.products.length === 0 ? <Card><Text style={{ color: colors.inkSoft, fontSize: 14 }}>No reconciliation products are configured.</Text></Card> : null}
    </> : null}
    {error && !selection ? <Card style={{ marginBottom: 12 }}><Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text></Card> : null}
    {!stock ? <PrimaryButton label="Retry" onPress={() => void load()} /> : null}
    <Modal visible={selection !== null} transparent animationType="fade" onRequestClose={() => !saving && setSelection(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)", padding: 24 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 18 }}>
            <Text style={{ color: selectedToneColor, fontSize: 17, fontWeight: "800" }}>{selectedCue?.symbol} {selection ? labels[selection.action] : ""}</Text>
            <Text style={{ color: colors.inkFaint, fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>{selection?.product.name} · {selection?.product.unit}</Text>
            {selection?.action === "MORNING_REFILL" ? <Text style={{ color: colors.inkSoft, fontSize: 13, marginTop: 12 }}>Include stock taken from the fridge and any new stock.</Text> : null}
            <Text style={{ color: colors.inkFaint, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginTop: 16 }}>Quantity ({selection?.product.unit})</Text>
            <TextInput value={quantity} onChangeText={(value) => { setQuantity(value); setRequestId(null); }} keyboardType="decimal-pad" autoFocus
              placeholder="0" placeholderTextColor={colors.inkFaint}
              style={{ color: colors.ink, backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 22, fontWeight: "800", marginTop: 8 }} />
            {error ? <Text style={{ color: colors.danger, fontSize: 13, marginTop: 8 }}>{error}</Text> : null}
            <Text style={{ color: colors.inkSoft, fontSize: 12, marginTop: 10 }}>Saved entries cannot be edited.</Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <Pressable disabled={saving} onPress={() => { setSelection(null); setError(null); }} style={({ pressed }) => ({ flex: 1, alignItems: "center", justifyContent: "center", padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ color: colors.inkSoft, fontSize: 14, fontWeight: "700" }}>Cancel</Text>
              </Pressable>
              <View style={{ flex: 1 }}><PrimaryButton label={saving ? "Saving…" : "Save"} onPress={() => void save()} loading={saving} /></View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}
