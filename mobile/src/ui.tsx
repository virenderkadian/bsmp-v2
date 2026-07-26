import { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { radius, useTheme, type Palette } from "@/theme";

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.lg,
          padding: 16,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => ({
        backgroundColor: colors.brand,
        borderRadius: radius.md,
        paddingVertical: 15,
        alignItems: "center",
        opacity: off ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={colors.onBrand} />
      ) : (
        <Text style={{ color: colors.onBrand, fontSize: 15, fontWeight: "700" }}>{label}</Text>
      )}
    </Pressable>
  );
}

export function GhostButton({
  label,
  onPress,
  tone = "brand",
}: {
  label: string;
  onPress: () => void;
  tone?: "brand" | "danger";
}) {
  const { colors } = useTheme();
  const color = tone === "danger" ? colors.danger : colors.brand;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.surface,
        borderColor: colors.borderStrong,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: radius.md,
        paddingVertical: 15,
        alignItems: "center",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color, fontSize: 15, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

type Tone = "delivered" | "skipped" | "pending" | "brand";

export function Chip({ label, tone }: { label: string; tone: Tone }) {
  const { colors } = useTheme();
  const map: Record<Tone, [string, string]> = {
    delivered: [colors.delivered, colors.deliveredTint],
    skipped: [colors.skipped, colors.skippedTint],
    pending: [colors.pending, colors.pendingTint],
    brand: [colors.brand, colors.brandTint],
  };
  const [fg, bg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10, alignSelf: "flex-start" }}>
      <Text style={{ color: fg, fontSize: 11.5, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.pendingTint, overflow: "hidden" }}>
      <View style={{ height: "100%", width: `${pct * 100}%`, backgroundColor: colors.brand, borderRadius: radius.pill }} />
    </View>
  );
}

export function ScreenTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: 12 }}>
      {subtitle ? <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{subtitle}</Text> : null}
      <Text style={{ color: colors.ink, fontSize: 24, fontWeight: "800", letterSpacing: -0.4 }}>{title}</Text>
    </View>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text style={{ color: colors.inkFaint, fontSize: 11, fontWeight: "700", letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 10, marginLeft: 4 }}>
      {children}
    </Text>
  );
}

export function useColors(): Palette {
  return useTheme().colors;
}
