import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
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
  // The raw text while the driver is typing; null the rest of the time, when
  // the field just shows the formatted value. Keeping the raw text means "2."
  // or an emptied field can be typed through without being rewritten under
  // the driver's fingers.
  const [typed, setTyped] = useState<string | null>(null);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const btn = (icon: "add" | "remove", onPress: () => void) => (
    <Pressable
      onPress={() => {
        setTyped(null);
        onPress();
      }}
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
      <TextInput
        value={typed ?? fmt(value)}
        onFocus={() => setTyped(value === 0 ? "" : String(value))}
        onBlur={() => setTyped(null)}
        onChangeText={(text) => {
          // Digits and a single dot, at most three decimals — the same
          // precision the server accepts.
          const cleaned = text.replace(",", ".").replace(/[^0-9.]/g, "");
          if (!/^\d{0,4}(\.\d{0,3})?$/.test(cleaned)) return;
          setTyped(cleaned);
          const parsed = cleaned === "" || cleaned === "." ? 0 : Number(cleaned);
          onChange(Math.max(min, round(parsed)));
        }}
        keyboardType="decimal-pad"
        selectTextOnFocus
        maxLength={8}
        accessibilityLabel="Quantity"
        // Grows with the text instead of clipping it at a fixed width, but the
        // multiplier is capped: the +/− buttons beside it are fixed-size.
        maxFontSizeMultiplier={1.4}
        style={{
          minWidth: 56,
          paddingHorizontal: 4,
          paddingVertical: 0,
          textAlign: "center",
          color: value > 0 ? colors.ink : colors.inkFaint,
          fontSize: 15,
          fontWeight: "800",
          fontVariant: ["tabular-nums"],
        }}
      />
      {btn("add", () => onChange(round(value + step)))}
    </View>
  );
}
