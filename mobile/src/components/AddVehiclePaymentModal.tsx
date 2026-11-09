import * as Crypto from "expo-crypto";
import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { VehiclePaymentMode } from "@shared/driver-api-types";
import { api, ApiError } from "@/api";
import { SafeModal } from "@/components/SafeModal";
import { radius } from "@/theme";
import { Card, PrimaryButton, useColors } from "@/ui";

const MODES: Array<{ id: VehiclePaymentMode; label: string }> = [
  { id: "CASH", label: "Cash" }, { id: "UPI", label: "UPI" }, { id: "BANK_TRANSFER", label: "Bank" }, { id: "CHEQUE", label: "Cheque" },
];

function rupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

// An admin recording the money a vehicle has handed in. It is recorded as
// received straight away (the admin is the person who verifies), so it counts at
// once against what the driver still owes — hence the confirmation step.
export function AddVehiclePaymentModal({ visible, onClose, onSaved, vehicleLabel, cycleDate, balance }: {
  visible: boolean; onClose: () => void; onSaved: () => void; vehicleLabel: string; cycleDate: string;
  // What is still to account for; pre-fills the amount and is what an over-payment is checked against.
  balance: number;
}) {
  const colors = useColors();
  const [amount, setAmount] = useState(balance > 0 ? String(balance) : "");
  const [mode, setMode] = useState<VehiclePaymentMode>("CASH");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per entry: the server uses it as the payment's id, so pressing Save
  // again after a dropped connection cannot record the money twice.
  const [requestId, setRequestId] = useState(() => Crypto.randomUUID());

  // Each time it opens, start from the current balance (it is mounted before the
  // stock has loaded, so the first value may be stale).
  useEffect(() => {
    if (visible) {
      setAmount(balance > 0 ? String(balance) : "");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const parsed = Number(amount);
  const valid = /^\d+(\.\d{1,2})?$/.test(amount) && parsed > 0;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.adminAddVehiclePayment({ requestId, cycleDate, amount, mode, referenceNo: reference.trim() || undefined, notes: notes.trim() || undefined });
      setRequestId(Crypto.randomUUID());
      setAmount(""); setReference(""); setNotes(""); setMode("CASH");
      onSaved();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not record the payment. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const confirm = () => {
    const over = parsed - balance > 0.005;
    const lines = [`${rupees(parsed)} ${MODES.find((item) => item.id === mode)?.label.toLowerCase()} received from ${vehicleLabel}.`];
    if (over) lines.push(`That is more than the ${rupees(Math.max(0, balance))} still to account for.`);
    lines.push("It counts straight away.");
    Alert.alert(over ? "More than expected" : "Record this payment?", lines.join("\n\n"), [
      { text: "Cancel", style: "cancel" },
      { text: "Record", onPress: () => void save() },
    ]);
  };

  const input = { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, color: colors.ink, fontSize: 16 } as const;
  const label = { color: colors.inkFaint, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 8, marginLeft: 4 } as const;

  return (
    <SafeModal visible={visible} onClose={onClose}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "800" }}>Add payment</Text>
          <Text style={{ color: colors.inkFaint, fontSize: 12.5 }} numberOfLines={1}>{vehicleLabel}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close"
          style={{ width: 34, height: 34, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.ink, fontSize: 16 }}>✕</Text>
        </Pressable>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
          <Text style={label}>Amount received</Text>
          <TextInput value={amount} onChangeText={(value) => { setAmount(value.replace(",", ".")); setError(null); }} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.inkFaint}
            style={{ ...input, fontSize: 24, fontWeight: "800", marginBottom: 6 }} />
          {balance > 0 ? (
            <Pressable onPress={() => setAmount(String(balance))} style={{ alignSelf: "flex-start", marginBottom: 16, marginLeft: 4 }}>
              <Text style={{ color: colors.brand, fontSize: 13, fontWeight: "700" }}>Use full balance · {rupees(balance)}</Text>
            </Pressable>
          ) : <View style={{ height: 16 }} />}

          <Text style={label}>How was it paid</Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
            {MODES.map((item) => {
              const active = mode === item.id;
              return (
                <Pressable key={item.id} onPress={() => setMode(item.id)}
                  style={{ flex: 1, paddingVertical: 11, borderRadius: radius.md, alignItems: "center", backgroundColor: active ? colors.brand : colors.surface, borderWidth: active ? 0 : 1, borderColor: colors.border }}>
                  <Text style={{ color: active ? colors.onBrand : colors.inkSoft, fontSize: 13.5, fontWeight: "700" }}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {mode !== "CASH" ? (
            <>
              <Text style={label}>Reference (optional)</Text>
              <TextInput value={reference} onChangeText={setReference} placeholder={mode === "CHEQUE" ? "Cheque number" : "Transaction id"} placeholderTextColor={colors.inkFaint}
                autoCapitalize="characters" autoCorrect={false} maxLength={100} style={{ ...input, marginBottom: 16 }} />
            </>
          ) : null}

          <Text style={label}>Note (optional)</Text>
          <TextInput value={notes} onChangeText={setNotes} placeholder="Anything worth remembering" placeholderTextColor={colors.inkFaint} multiline maxLength={500}
            style={{ ...input, minHeight: 70, textAlignVertical: "top", marginBottom: 16 }} />

          {error ? <Card style={{ marginBottom: 14 }}><Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text></Card> : null}
          <PrimaryButton label="Review and record" onPress={confirm} loading={saving} disabled={!valid || saving} />
          <Text style={{ color: colors.inkFaint, fontSize: 12, textAlign: "center", marginTop: 12, lineHeight: 17 }}>
            Recorded against the cycle shown. A mistake can be cancelled from the web app.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeModal>
  );
}
