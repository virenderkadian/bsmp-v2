import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { AdminVehicle } from "@shared/driver-api-types";
import { api, ApiError } from "@/api";
import { useOfflineSync } from "@/offline-sync-context";
import { useSession } from "@/session";
import { radius } from "@/theme";
import { Card, useColors } from "@/ui";

// Where an admin chooses which vehicle to act on. Shown right after an admin
// signs in, and again from the dashboard's "Switch" button.
export default function VehiclePickerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { admin, vehicle, selectVehicle, signOut } = useSession();
  const { pendingCount } = useOfflineSync();
  const [vehicles, setVehicles] = useState<AdminVehicle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      setVehicles((await api.adminVehicles()).vehicles);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load vehicles.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matching = (vehicles ?? []).filter((item) => !query || `${item.code} ${item.name} ${item.cityName}`.toLowerCase().includes(query));
    const byCity = new Map<string, AdminVehicle[]>();
    matching.forEach((item) => byCity.set(item.cityName, [...(byCity.get(item.cityName) ?? []), item]));
    return [...byCity.entries()];
  }, [vehicles, search]);

  const choose = (next: AdminVehicle) => {
    const go = async () => {
      await selectVehicle({ id: next.id, code: next.code, name: next.name, cityId: next.cityId });
      // Back to the tabs, closing anything opened for the previous vehicle.
      router.dismissTo("/(tabs)");
    };
    if (vehicle && next.id === vehicle.id) {
      router.back();
      return;
    }
    // Changes made offline belong to the vehicle they were made on, and would be
    // sent under the new one. Make the admin finish them first.
    if (vehicle && pendingCount > 0) {
      Alert.alert(
        "Unsent changes",
        `${pendingCount} change${pendingCount === 1 ? "" : "s"} for ${vehicle.code} haven't reached the server yet. Connect and let them send before switching vehicles.`,
      );
      return;
    }
    void go();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 }}>
        {vehicle ? (
          <Pressable onPress={() => router.back()}
            style={{ width: 36, height: 36, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chevron-back" size={20} color={colors.ink} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "800" }}>Choose a vehicle</Text>
          {admin ? <Text style={{ color: colors.inkFaint, fontSize: 12 }}>Signed in as {admin.name}</Text> : null}
        </View>
        {!vehicle ? (
          <Pressable onPress={() => void signOut()} style={({ pressed }) => ({ paddingVertical: 8, paddingHorizontal: 12, opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ color: colors.danger, fontSize: 14, fontWeight: "700" }}>Sign out</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by code, name or city"
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.ink }}
        />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24 + insets.bottom }} keyboardShouldPersistTaps="handled">
        {error ? <Card><Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text></Card> : null}
        {!vehicles && !error ? <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} /> : null}
        {vehicles && vehicles.length === 0 ? <Card><Text style={{ color: colors.inkSoft, fontSize: 14 }}>No vehicles are available to your account.</Text></Card> : null}
        {vehicles && vehicles.length > 0 && grouped.length === 0 ? <Card><Text style={{ color: colors.inkSoft, fontSize: 14 }}>No vehicle matches that search.</Text></Card> : null}
        {grouped.map(([city, items]) => (
          <View key={city} style={{ marginBottom: 14 }}>
            <Text style={{ color: colors.inkFaint, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 8, marginLeft: 4 }}>{city}</Text>
            <Card style={{ padding: 0 }}>
              {items.map((item, index) => {
                const selected = vehicle?.id === item.id;
                return (
                  <Pressable key={item.id} onPress={() => choose(item)}
                    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 14,
                      borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colors.border, backgroundColor: selected ? colors.brandTint : "transparent", opacity: pressed ? 0.6 : 1 })}>
                    <Ionicons name="bus-outline" size={22} color={colors.brand} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "800" }}>{item.code}</Text>
                      <Text style={{ color: colors.inkSoft, fontSize: 13 }} numberOfLines={1}>{item.name}</Text>
                    </View>
                    {selected ? <Ionicons name="checkmark-circle" size={22} color={colors.brand} /> : <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />}
                  </Pressable>
                );
              })}
            </Card>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
