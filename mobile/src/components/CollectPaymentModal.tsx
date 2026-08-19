import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import type { DriverSheetCustomer } from "@shared/driver-api-types";
import { radius } from "@/theme";
import { Card, PrimaryButton, useColors } from "@/ui";

// Collecting at the door. Opened from the customer card, never shown inline —
// the card has to stay readable one-handed, and this only appears when the
// driver has actually decided to ask for money.
export function CollectPaymentModal({
  visible,
  onClose,
  customer,
  upi,
  saving,
  onCollect,
}: {
  visible: boolean;
  onClose: () => void;
  customer: DriverSheetCustomer;
  upi: { upiId: string; payeeName: string } | null;
  saving: boolean;
  onCollect: (amount: number, mode: "CASH" | "UPI") => void;
}) {
  const colors = useColors();
  const suggested = customer.previousBill ? Number(customer.previousBill.outstanding) : 0;
  // Editable, because part payments happen — a customer hands over what they
  // have rather than the exact billed figure.
  const [amount, setAmount] = useState(suggested > 0 ? String(suggested) : "");

  const parsedAmount = Number(amount) || 0;

  // Built on the device rather than fetched, so it works with no signal. `am`
  // prefills the amount and `tn` carries the customer code so the office can
  // match the receipt to a customer later.
  //
  // Worth knowing: `tn` is honoured inconsistently across UPI apps — some
  // shorten or drop it — so it's a convenience for reconciliation, not a
  // guarantee. The amount prefill is reliable.
  const upiUri = useMemo(() => {
    if (!upi || parsedAmount <= 0) return null;
    const params = new URLSearchParams({
      pa: upi.upiId,
      pn: upi.payeeName,
      am: parsedAmount.toFixed(2),
      cu: "INR",
      tn: `${customer.customerCode ?? ""} paid the bill`.trim(),
    });
    return `upi://pay?${params.toString()}`;
  }, [upi, parsedAmount, customer.customerCode]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "800" }}>Collect payment</Text>
            <Text style={{ color: colors.inkFaint, fontSize: 12.5 }} numberOfLines={1}>
              {customer.name}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            style={{ width: 34, height: 34, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: colors.ink, fontSize: 16 }}>✕</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
          {customer.previousBill ? (
            <Card style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: colors.inkSoft, fontSize: 13 }}>Unpaid bill</Text>
                <Text style={{ color: colors.skipped, fontSize: 16, fontWeight: "800" }}>
                  ₹ {Number(customer.previousBill.outstanding).toFixed(2)}
                </Text>
              </View>
            </Card>
          ) : null}

          <Text style={{ color: colors.inkFaint, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 8, marginLeft: 4 }}>
            Amount received
          </Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.inkFaint}
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: radius.md,
              paddingHorizontal: 14,
              paddingVertical: 14,
              color: colors.ink,
              fontSize: 22,
              fontWeight: "800",
              marginBottom: 14,
            }}
          />

          {upiUri ? (
            <Card style={{ marginBottom: 14, alignItems: "center" }}>
              <Text style={{ color: colors.inkSoft, fontSize: 13, marginBottom: 12 }}>
                Customer scans to pay ₹ {parsedAmount.toFixed(2)}
              </Text>
              {/* White backing regardless of theme — a dark QR on a dark
                  surface won't scan. */}
              <View style={{ backgroundColor: "#ffffff", padding: 12, borderRadius: radius.md }}>
                <QRCode value={upiUri} size={200} />
              </View>
              <Text style={{ color: colors.inkFaint, fontSize: 11.5, marginTop: 10, textAlign: "center" }}>
                {upi?.payeeName}
              </Text>
            </Card>
          ) : upi ? (
            <Card style={{ marginBottom: 14 }}>
              <Text style={{ color: colors.inkFaint, fontSize: 13, textAlign: "center" }}>
                Enter an amount to show the scan code.
              </Text>
            </Card>
          ) : (
            <Card style={{ marginBottom: 14 }}>
              <Text style={{ color: colors.inkFaint, fontSize: 13, textAlign: "center" }}>
                No UPI id set for this city — cash only.
              </Text>
            </Card>
          )}

          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                label="Paid by UPI"
                onPress={() => onCollect(parsedAmount, "UPI")}
                disabled={parsedAmount <= 0 || saving || !upi}
              />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                label="Paid cash"
                onPress={() => onCollect(parsedAmount, "CASH")}
                disabled={parsedAmount <= 0 || saving}
              />
            </View>
          </View>

          {/* Said plainly, because a driver marking this must not believe the
              customer's account is now settled — the office decides that. */}
          <Text style={{ color: colors.inkFaint, fontSize: 12, textAlign: "center", marginTop: 14, lineHeight: 17 }}>
            Recorded as pending. The office will verify it before it counts
            against the customer&apos;s balance.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
