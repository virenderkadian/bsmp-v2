import Constants from "expo-constants";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { TAB_BAR_HEIGHT } from "@/components/ActiveRoutePill";
import { useRouter } from "expo-router";
import { useSession } from "@/session";
import { THEME_IDS, THEME_META, type ThemeId } from "@/theme";
import { useTheme, type Appearance } from "@/theme-preference";
import { Card, Eyebrow, GhostButton, ScreenTitle, useColors } from "@/ui";

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

function PickerRow({
  label,
  active,
  onPress,
  swatch,
  last,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  swatch?: string;
  last?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 13,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {swatch ? <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: swatch }} /> : null}
      <Text style={{ flex: 1, color: colors.ink, fontSize: 15, fontWeight: "600" }}>{label}</Text>
      {active ? <Text style={{ color: colors.brand, fontSize: 17, fontWeight: "800" }}>✓</Text> : null}
    </Pressable>
  );
}

const APPEARANCE_OPTIONS: Array<{ id: Appearance; label: string }> = [
  { id: "system", label: "System (auto)" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { vehicle, admin, signOut } = useSession();
  const { appearance, setAppearance, themeId, setThemeId } = useTheme();
  const version = Constants.expoConfig?.version ?? "1.0.0";

  const soon = () => Alert.alert("Coming soon", "This will be added in a later update.");
  const confirmLogout = () =>
    Alert.alert("Log out?", admin ? "You'll need your email and password to sign back in." : "You'll need your vehicle code and PIN to sign back in.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: () => signOut() },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
      {/* NativeTabs' bar isn't excluded from this screen's own frame (see the
      comment on TAB_BAR_HEIGHT in ActiveRoutePill.tsx), so without this the
      last card — here, Log out — renders underneath it with no extra
      scroll room to reveal it. */}
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 24 + insets.bottom + TAB_BAR_HEIGHT }}>
        <ScreenTitle title="Profile" />

        <Card style={{ flexDirection: "row", alignItems: "center", gap: 13, marginBottom: 16 }}>
          <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: colors.brandTint, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 24 }}>🚚</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "800" }}>
              {vehicle ? `${vehicle.code} · ${vehicle.name}` : "Vehicle"}
            </Text>
            <Text style={{ color: colors.inkSoft, fontSize: 13 }}>
              {admin ? `Signed in as ${admin.name} (${admin.role === "SUPERADMIN" ? "Superadmin" : "Admin"})` : "Signed in"}
            </Text>
          </View>
        </Card>

        {admin ? (
          <View style={{ marginBottom: 16 }}>
            <GhostButton label="Switch vehicle" onPress={() => router.push("/admin/vehicles" as never)} />
          </View>
        ) : null}

        <Eyebrow>Appearance</Eyebrow>
        <Card style={{ paddingVertical: 2, marginBottom: 16 }}>
          {APPEARANCE_OPTIONS.map((option, index) => (
            <PickerRow
              key={option.id}
              label={option.label}
              active={appearance === option.id}
              onPress={() => setAppearance(option.id)}
              last={index === APPEARANCE_OPTIONS.length - 1}
            />
          ))}
        </Card>

        <Eyebrow>Theme</Eyebrow>
        <Card style={{ paddingVertical: 2, marginBottom: 16 }}>
          {THEME_IDS.map((id: ThemeId, index) => (
            <PickerRow
              key={id}
              label={THEME_META[id].label}
              swatch={THEME_META[id].swatch}
              active={themeId === id}
              onPress={() => setThemeId(id)}
              last={index === THEME_IDS.length - 1}
            />
          ))}
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
