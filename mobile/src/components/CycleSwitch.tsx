import { Pressable, Text, View } from "react-native";
import { radius } from "@/theme";
import { useColors } from "@/ui";

// One small segmented control instead of two full-size buttons.
export function CycleSwitch({ previous, onChange }: { previous: boolean; onChange: (previous: boolean) => void }) {
  const colors = useColors();
  return <View style={{ flexDirection: "row", backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, padding: 3, marginBottom: 12 }}>
    {([false, true] as const).map((value) => {
      const active = previous === value;
      return <Pressable key={String(value)} onPress={() => onChange(value)}
        style={({ pressed }) => ({
          flex: 1, paddingVertical: 8, borderRadius: radius.pill, alignItems: "center",
          backgroundColor: active ? colors.brand : "transparent",
          opacity: pressed ? 0.78 : 1,
        })}>
        <Text style={{ color: active ? colors.onBrand : colors.inkSoft, fontSize: 13, fontWeight: "700" }}>
          {value ? "Previous cycle" : "Current cycle"}
        </Text>
      </Pressable>;
    })}
  </View>;
}
