import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { radius } from "@/theme";
import { useColors } from "@/ui";

function fmt(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(Math.round(value * 1000) / 1000);
}

export function Stepper({
  value,
  onChange,
  step = 0.5,
  min = 0,
}: {
  value: number;
  onChange: (next: number) => void;
  step?: number;
  min?: number;
}) {
  const colors = useColors();
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const btn = (icon: "add" | "remove", onPress: () => void) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.surface2,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={22} color={colors.brand} />
    </Pressable>
  );

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderRadius: radius.sm,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.borderStrong,
        overflow: "hidden",
        backgroundColor: colors.surface,
      }}
    >
      {btn("remove", () => onChange(round(Math.max(min, value - step))))}
      <Text
        style={{
          width: 50,
          textAlign: "center",
          color: value > 0 ? colors.ink : colors.inkFaint,
          fontSize: 15,
          fontWeight: "800",
          fontVariant: ["tabular-nums"],
        }}
      >
        {fmt(value)}
      </Text>
      {btn("add", () => onChange(round(value + step)))}
    </View>
  );
}
