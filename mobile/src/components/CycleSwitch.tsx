import { Pressable, Text, View } from "react-native";
import { radius } from "@/theme";
import { useColors } from "@/ui";

export function CycleSwitch({ previous, onChange }: { previous: boolean; onChange: (previous: boolean) => void }) {
  const colors = useColors();
  return <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
    {([false, true] as const).map((value) => {
      const active = previous === value;
      return <Pressable key={String(value)} onPress={() => onChange(value)}
        style={({ pressed }) => ({
          flex: 1, paddingVertical: 11, borderRadius: radius.md, alignItems: "center",
          backgroundColor: active ? colors.brand : colors.surface,
          borderWidth: active ? 0 : 1, borderColor: colors.border,
          opacity: pressed ? 0.78 : 1,
        })}>
        <Text style={{ color: active ? colors.onBrand : colors.inkSoft, fontSize: 13.5, fontWeight: "700" }}>
          {value ? "Previous cycle" : "Current cycle"}
        </Text>
      </Pressable>;
    })}
  </View>;
}
