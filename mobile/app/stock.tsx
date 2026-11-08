import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StockPanel } from "@/components/StockPanel";
import { radius } from "@/theme";
import { useColors } from "@/ui";

export default function StockScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 }}>
      <Pressable onPress={() => router.back()}
        style={{ width: 36, height: 36, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: colors.ink, fontSize: 20, marginTop: -2 }}>‹</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "800" }}>Vehicle stock</Text>
        <Text style={{ color: colors.inkFaint, fontSize: 12 }}>Taken, sold and returned</Text>
      </View>
    </View>
    <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 24 + insets.bottom }} keyboardShouldPersistTaps="handled">
      <StockPanel />
    </ScrollView>
  </SafeAreaView>;
}
