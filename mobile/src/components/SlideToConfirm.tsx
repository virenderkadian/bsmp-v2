import { useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { radius } from "@/theme";
import { useColors } from "@/ui";

const KNOB = 46;
const PAD = 4;
const THRESHOLD = 0.72; // fraction of the track you must cross to confirm

type Props = {
  direction: "right" | "left";
  label: string;
  tone: "delivered" | "skipped";
  onConfirm: () => void;
  disabled?: boolean;
};

// A committed slide (iOS "slide to power off" style): drag the handle across the
// track past THRESHOLD to fire onConfirm. Two of these — one dragging right to
// deliver, one dragging left to skip — so a stray tap can never mark a stop.
export function SlideToConfirm({ direction, label, tone, onConfirm, disabled }: Props) {
  const colors = useColors();
  const [trackWidth, setTrackWidth] = useState(0);
  const x = useSharedValue(0);
  const maxTravel = useSharedValue(0);

  const fg = tone === "delivered" ? colors.delivered : colors.skipped;
  const bg = tone === "delivered" ? colors.deliveredTint : colors.skippedTint;

  const onLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setTrackWidth(width);
    maxTravel.value = Math.max(0, width - KNOB - PAD * 2);
  };

  const gesture = Gesture.Pan()
    .enabled(!disabled)
    .onUpdate((event) => {
      const travel = direction === "right" ? event.translationX : -event.translationX;
      x.value = Math.max(0, Math.min(maxTravel.value, travel));
    })
    .onEnd(() => {
      if (maxTravel.value > 0 && x.value >= maxTravel.value * THRESHOLD) {
        x.value = withSpring(maxTravel.value, { damping: 18 });
        runOnJS(onConfirm)();
      } else {
        x.value = withSpring(0, { damping: 18 });
      }
    });

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: direction === "right" ? x.value : -x.value }],
  }));
  const fillStyle = useAnimatedStyle(() => ({
    width: KNOB + x.value + PAD,
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: maxTravel.value > 0 ? 1 - x.value / maxTravel.value : 1,
  }));

  const arrow = direction === "right" ? "›" : "‹";

  return (
    <View
      onLayout={onLayout}
      style={{
        height: 54,
        borderRadius: radius.md,
        backgroundColor: bg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        justifyContent: "center",
        overflow: "hidden",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {/* growing fill trailing the knob */}
      <Animated.View
        style={[
          {
            position: "absolute",
            top: PAD,
            bottom: PAD,
            [direction === "right" ? "left" : "right"]: PAD,
            borderRadius: radius.sm,
            backgroundColor: fg,
            opacity: 0.18,
          },
          fillStyle,
        ]}
      />
      <Animated.Text style={[{ textAlign: "center", color: fg, fontSize: 14, fontWeight: "700" }, labelStyle]}>
        {direction === "left" ? `${arrow} ` : ""}
        {label}
        {direction === "right" ? ` ${arrow}` : ""}
      </Animated.Text>
      {trackWidth > 0 ? (
        <GestureDetector gesture={gesture}>
          <Animated.View
            style={[
              {
                position: "absolute",
                [direction === "right" ? "left" : "right"]: PAD,
                width: KNOB,
                height: KNOB,
                borderRadius: radius.sm,
                backgroundColor: colors.surface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.borderStrong,
                alignItems: "center",
                justifyContent: "center",
              },
              knobStyle,
            ]}
          >
            <Text style={{ color: fg, fontSize: 22, fontWeight: "800", marginTop: -2 }}>{arrow}</Text>
          </Animated.View>
        </GestureDetector>
      ) : null}
    </View>
  );
}
