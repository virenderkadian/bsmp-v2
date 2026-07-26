import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { DriverSheetCustomer } from "@shared/driver-api-types";
import { radius } from "@/theme";
import { Chip, useColors } from "@/ui";

// Search-and-jump list over every stop on the route — the one clearly-scoped
// screen still missing from the original design. Implemented as a Modal
// rather than a separate expo-router screen: it reuses the run screen's
// already-loaded sheet and cursor state directly via props/closures (no
// cross-screen state passing needed), and RN's Modal renders through a true
// native presentation layer, so it's guaranteed to sit above everything —
// including the native tab bar — with none of the z-order uncertainty a
// second pushed route would carry.
export function StopsListModal({
  visible,
  onClose,
  customers,
  currentIndex,
  statusOf,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  customers: DriverSheetCustomer[];
  currentIndex: number;
  statusOf: (customer: DriverSheetCustomer) => { tone: "delivered" | "skipped" | "pending"; label: string };
  onSelect: (index: number) => void;
}) {
  const colors = useColors();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter(
      (customer) => customer.name.toLowerCase().includes(query) || (customer.area ?? "").toLowerCase().includes(query),
    );
  }, [customers, search]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
          <Text style={{ flex: 1, color: colors.ink, fontSize: 18, fontWeight: "800" }}>All stops</Text>
          <Pressable
            onPress={onClose}
            style={{ width: 34, height: 34, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: colors.ink, fontSize: 16 }}>✕</Text>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search name or area"
            placeholderTextColor={colors.inkFaint}
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: radius.md,
              paddingHorizontal: 14,
              paddingVertical: 11,
              color: colors.ink,
              fontSize: 14,
            }}
          />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
          {filtered.length === 0 ? (
            <Text style={{ color: colors.inkFaint, fontSize: 14, textAlign: "center", marginTop: 30 }}>
              No matching customers.
            </Text>
          ) : (
            filtered.map((customer) => {
              const index = customers.findIndex((entry) => entry.customerId === customer.customerId);
              const isCurrent = index === currentIndex;
              const status = statusOf(customer);
              const summary = customer.products
                .filter((product) => Number(product.deliveredQty) > 0)
                .map((product) => `${product.code} ${product.deliveredQty}`)
                .join(" · ");

              return (
                <Pressable
                  key={customer.customerId}
                  onPress={() => onSelect(index)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingVertical: 12,
                    paddingHorizontal: isCurrent ? 10 : 0,
                    marginHorizontal: isCurrent ? -10 : 0,
                    borderRadius: isCurrent ? radius.md : 0,
                    borderBottomWidth: isCurrent ? 0 : 1,
                    borderBottomColor: colors.border,
                    backgroundColor: isCurrent ? colors.brandTint : pressed ? colors.surface2 : "transparent",
                  })}
                >
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "700" }}>
                      {customer.sequenceNo}. {customer.name}
                    </Text>
                    {summary || customer.area ? (
                      <Text style={{ color: colors.inkFaint, fontSize: 12.5, marginTop: 2 }}>{summary || customer.area}</Text>
                    ) : null}
                  </View>
                  <Chip label={isCurrent ? "Now" : status.label} tone={isCurrent ? "brand" : status.tone} />
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
