import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Pressable, Text } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from "react-native-reanimated";
import { radius } from "@/theme";
import { useColors } from "@/ui";

// "Recorded as delivered · tap to edit", with the "tap to edit" part picked out
// and the whole button given a small double bounce a couple of seconds after a
// recorded stop comes up, so a driver who needs to correct something sees how.
//
// The bounce is skipped when the phone's "reduce motion" setting is on.
const BOUNCE_DELAY_MS = 2500;

export function EditPrompt({ summary, onPress, bounceKey }: { summary: string; onPress: () => void; bounceKey: string }) {
  const colors = useColors();
  const scale = useSharedValue(1);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    // After a short pause, not the instant the stop appears: the driver is
    // still taking in the card, and a bounce after a couple of seconds reads as
    // "this is tappable" rather than as part of the page loading in.
    scale.value = 1;
    scale.value = withDelay(
      BOUNCE_DELAY_MS,
      withSequence(
        withTiming(1.05, { duration: 150 }), withTiming(1, { duration: 150 }),
        withTiming(1.05, { duration: 150 }), withTiming(1, { duration: 150 }),
      ),
    );
    // Moving to another stop before it fires cancels it; the new stop starts its own.
    return () => cancelAnimation(scale);
  }, [bounceKey, reduceMotion, scale]);

  const bounce = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={bounce}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${summary}. Edit`}
        style={({ pressed }) => ({
          flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, paddingHorizontal: 12,
          borderRadius: radius.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.brand, opacity: pressed ? 0.7 : 1,
        })}
      >
        <Ionicons name="create-outline" size={18} color={colors.brand} />
        <Text style={{ flexShrink: 1, textAlign: "center", color: colors.inkSoft, fontSize: 13.5, fontWeight: "600" }}>
          {summary}  ·  <Text style={{ color: colors.brand, fontWeight: "800" }}>Tap to edit</Text>
        </Text>
      </Pressable>
    </Animated.View>
  );
}
