import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { DriverSheetProduct } from "@shared/driver-api-types";
import { addCashSaleEntry, deleteCashSaleEntry, getCashSaleEntries, type CashSaleEntry, type CashSaleItem } from "@/cash-sale";
import { radius } from "@/theme";
import { Card, GhostButton, PrimaryButton, useColors } from "@/ui";

const DECIMAL_RE = /^\d*\.?\d*$/;

type DraftRow = { quantity: string; amount: string };

function roundQty(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return rounded > 0 ? String(rounded) : "";
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// Fast, local-only cash sale entry — no server call, ever. Entries live in
// AsyncStorage (see src/cash-sale.ts) and self-expire after 2 days; this is a
// driver scratchpad for tracking/reporting cash collected outside the normal
// delivery round, not part of the billing system.
export function CashSaleModal({
  visible,
  onClose,
  routeId,
  products,
}: {
  visible: boolean;
  onClose: () => void;
  routeId: string;
  products: DriverSheetProduct[];
}) {
  const colors = useColors();
  const [mode, setMode] = useState<"entry" | "history">("entry");
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});
  const [saving, setSaving] = useState(false);
  const [entries, setEntries] = useState<CashSaleEntry[]>([]);

  const loadEntries = useCallback(async () => {
    const result = await getCashSaleEntries(routeId);
    setEntries(result);
  }, [routeId]);

  useEffect(() => {
    if (visible) {
      loadEntries();
    }
  }, [visible, loadEntries]);

  const updateQuantity = (productId: string, rate: number, value: string) => {
    if (!DECIMAL_RE.test(value)) return;
    const qty = Number(value) || 0;
    setDraft((prev) => ({ ...prev, [productId]: { quantity: value, amount: qty > 0 ? (qty * rate).toFixed(2) : "" } }));
  };

  const updateAmount = (productId: string, rate: number, value: string) => {
    if (!DECIMAL_RE.test(value)) return;
    const amount = Number(value) || 0;
    const qty = rate > 0 && amount > 0 ? amount / rate : 0;
    setDraft((prev) => ({ ...prev, [productId]: { quantity: roundQty(qty), amount: value } }));
  };

  const draftRows = useMemo(
    () =>
      products
        .map((product) => ({ product, row: draft[product.productId] ?? { quantity: "", amount: "" } }))
        .filter(({ row }) => Number(row.quantity) > 0 || Number(row.amount) > 0),
    [products, draft],
  );
  const totalQty = draftRows.reduce((sum, { row }) => sum + (Number(row.quantity) || 0), 0);
  const totalAmount = draftRows.reduce((sum, { row }) => sum + (Number(row.amount) || 0), 0);

  const handleClear = () => setDraft({});

  const handleSave = async () => {
    if (draftRows.length === 0 || saving) return;
    setSaving(true);
    try {
      const items: CashSaleItem[] = draftRows.map(({ product, row }) => ({
        productId: product.productId,
        code: product.code,
        unit: product.unit,
        rate: Number(product.rate),
        quantity: Number(row.quantity) || 0,
        amount: Number(row.amount) || 0,
      }));
      await addCashSaleEntry(routeId, items);
      setDraft({});
      await loadEntries();
      setMode("history");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert("Delete entry?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteCashSaleEntry(id);
          loadEntries();
        },
      },
    ]);
  };

  const historyTotal = entries.reduce((sum, entry) => sum + entry.totalAmount, 0);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
          <Text style={{ flex: 1, color: colors.ink, fontSize: 18, fontWeight: "800" }}>Cash Sale</Text>
          <Pressable
            onPress={onClose}
            style={{ width: 34, height: 34, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: colors.ink, fontSize: 16 }}>✕</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}>
          {(["entry", "history"] as const).map((tab) => {
            const active = mode === tab;
            return (
              <Pressable
                key={tab}
                onPress={() => setMode(tab)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: radius.md,
                  alignItems: "center",
                  backgroundColor: active ? colors.brand : colors.surface,
                  borderWidth: active ? 0 : 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ color: active ? colors.onBrand : colors.inkSoft, fontSize: 13.5, fontWeight: "700" }}>
                  {tab === "entry" ? "New entry" : `History (${entries.length})`}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {mode === "entry" ? (
          <>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}>
              <Card style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                  <Text style={{ color: colors.inkSoft, fontSize: 13 }}>Items</Text>
                  <Text style={{ color: colors.ink, fontSize: 14, fontWeight: "700" }}>{draftRows.length}</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                  <Text style={{ color: colors.inkSoft, fontSize: 13 }}>Total qty</Text>
                  <Text style={{ color: colors.ink, fontSize: 14, fontWeight: "700" }}>{totalQty}</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                  <Text style={{ color: colors.inkSoft, fontSize: 13 }}>Total amount</Text>
                  <Text style={{ color: colors.delivered, fontSize: 16, fontWeight: "800" }}>₹ {totalAmount.toFixed(2)}</Text>
                </View>
              </Card>

              {products.map((product, index) => {
                const row = draft[product.productId] ?? { quantity: "", amount: "" };
                return (
                  <View
                    key={product.productId}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingVertical: 10,
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: colors.border,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.ink, fontSize: 14, fontWeight: "700" }}>{product.shortName ?? product.code}</Text>
                      <Text style={{ color: colors.inkFaint, fontSize: 12 }}>₹ {product.rate} / {product.unit}</Text>
                    </View>
                    <TextInput
                      value={row.quantity}
                      onChangeText={(value) => updateQuantity(product.productId, Number(product.rate), value)}
                      placeholder="Qty"
                      placeholderTextColor={colors.inkFaint}
                      keyboardType="decimal-pad"
                      style={{
                        width: 64,
                        textAlign: "center",
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        borderWidth: 1,
                        borderRadius: radius.sm,
                        paddingVertical: 8,
                        color: colors.ink,
                        fontSize: 14,
                      }}
                    />
                    <TextInput
                      value={row.amount}
                      onChangeText={(value) => updateAmount(product.productId, Number(product.rate), value)}
                      placeholder="₹0"
                      placeholderTextColor={colors.inkFaint}
                      keyboardType="decimal-pad"
                      style={{
                        width: 80,
                        textAlign: "center",
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        borderWidth: 1,
                        borderRadius: radius.sm,
                        paddingVertical: 8,
                        color: colors.ink,
                        fontSize: 14,
                      }}
                    />
                  </View>
                );
              })}
            </ScrollView>
            <View style={{ flexDirection: "row", gap: 10, padding: 16 }}>
              <View style={{ flex: 1 }}>
                <GhostButton label="Clear" onPress={handleClear} />
              </View>
              <View style={{ flex: 2 }}>
                <PrimaryButton
                  label={saving ? "Saving…" : `Save ₹${totalAmount.toFixed(2)}`}
                  onPress={handleSave}
                  disabled={draftRows.length === 0}
                  loading={saving}
                />
              </View>
            </View>
          </>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
            <Card style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: colors.inkSoft, fontSize: 13 }}>Last 2 days total</Text>
                <Text style={{ color: colors.delivered, fontSize: 16, fontWeight: "800" }}>₹ {historyTotal.toFixed(2)}</Text>
              </View>
            </Card>

            {entries.length === 0 ? (
              <Text style={{ color: colors.inkFaint, fontSize: 14, textAlign: "center", marginTop: 20 }}>
                No cash sale entries in the last 2 days.
              </Text>
            ) : (
              entries.map((entry) => (
                <Card key={entry.id} style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={{ color: colors.inkFaint, fontSize: 12 }}>{formatDateTime(entry.createdAt)}</Text>
                      <Text style={{ color: colors.ink, fontSize: 13.5, marginTop: 4 }}>
                        {entry.items.map((item) => `${item.code} ${item.quantity}${item.unit}`).join(" · ")}
                      </Text>
                    </View>
                    <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "800" }}>₹ {entry.totalAmount.toFixed(2)}</Text>
                  </View>
                  <Pressable onPress={() => handleDelete(entry.id)} style={{ marginTop: 8, alignSelf: "flex-start" }}>
                    <Text style={{ color: colors.danger, fontSize: 12.5, fontWeight: "700" }}>Delete</Text>
                  </Pressable>
                </Card>
              ))
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}
