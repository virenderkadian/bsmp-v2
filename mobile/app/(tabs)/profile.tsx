import Constants from "expo-constants";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "@/session";
import { radius } from "@/theme";
import { Card, GhostButton, ScreenTitle, useColors } from "@/ui";

function MenuItem({ label, value, onPress, last }: { label: string; value?: string; onPress?: () => void; last?: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 15,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
        opacity: pressed && onPress ? 0.6 : 1,
      })}
    >
      <Text style={{ flex: 1, color: colors.ink, fontSize: 15, fontWeight: "600" }}>{label}</Text>
      {value ? <Text style={{ color: colors.inkFaint, fontSize: 13 }}>{value}</Text> : null}
      {onPress ? <Text style={{ color: colors.inkFaint, fontSize: 18, marginLeft: 8 }}>›</Text> : null}
    </Pressable>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const { vehicle, signOut } = useSession();
  const version = Constants.expoConfig?.version ?? "1.0.0";

  const soon = () => Alert.alert("Coming soon", "This will be added in a later update.");
  const confirmLogout = () =>
    Alert.alert("Log out?", "You'll need your vehicle code and PIN to sign back in.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: () => signOut() },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <ScreenTitle title="Profile" />

        <Card style={{ flexDirection: "row", alignItems: "center", gap: 13, marginBottom: 16 }}>
          <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: colors.brandTint, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 24 }}>🚚</Text>
          </View>
          <View>
            <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "800" }}>
              {vehicle ? `${vehicle.code} · ${vehicle.name}` : "Vehicle"}
            </Text>
            <Text style={{ color: colors.inkSoft, fontSize: 13 }}>Signed in</Text>
          </View>
        </Card>

        <Card style={{ paddingVertical: 2, marginBottom: 16 }}>
          <MenuItem label="Help & support" onPress={soon} />
          <MenuItem label="Terms of service" onPress={soon} />
          <MenuItem label="Privacy policy" onPress={soon} />
          <MenuItem label="About" value={`v${version}`} last />
        </Card>

        <GhostButton label="Log out" tone="danger" onPress={confirmLogout} />
      </ScrollView>
    </SafeAreaView>
  );
}
