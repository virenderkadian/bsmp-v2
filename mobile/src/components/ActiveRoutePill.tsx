import { usePathname, useRouter } from "expo-router";
import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useActiveRoute } from "@/active-route";
import { radius } from "@/theme";
import { useColors } from "@/ui";

// Standard tab bar content height (excluding the safe-area inset, which is
// added separately below) — 49pt is iOS's UITabBar constant regardless of
// liquid glass styling; 56dp is Material's baseline bottom-nav height.
// NativeTabs doesn't expose the real rendered height, so this is an
// approximation — nudge it if it visibly overlaps or gaps on a real device.
const TAB_BAR_HEIGHT = Platform.select({ ios: 49, android: 56, default: 56 });

// A persistent, tappable reminder that a route is mid-delivery — visible on
// every screen (Dashboard/Delivery/Profile, or the app cold-started back into
// the tabs) except the run screen for that exact route, where it'd just be
// pointing at the screen you're already on. Tapping it re-opens the run
// screen, which reconstructs the correct current stop purely from server data
// (saved lines), so it resumes in the right place with no client-side session
// state to go stale.
//
// Floats just above the bottom tab bar. This overlay is rendered as a sibling
// AFTER <Stack> at the root layout (see app/_layout.tsx), not nested inside
// any one tab's content — so it sits later in the same native view hierarchy
// NativeTabs mounts into, which normal platform z-ordering renders on top of.
export function ActiveRoutePill() {
  const { activeRoute } = useActiveRoute();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const colors = useColors();

  if (!activeRoute) {
    return null;
  }
  if (pathname === `/run/${activeRoute.id}`) {
    return null;
  }

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}>
      <Pressable
        onPress={() => router.push(`/run/${activeRoute.id}`)}
        style={({ pressed }) => ({
          marginBottom: insets.bottom + TAB_BAR_HEIGHT + 10,
          marginHorizontal: 14,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          backgroundColor: colors.brand,
          borderRadius: radius.pill,
          paddingVertical: 10,
          paddingHorizontal: 16,
          shadowColor: "#000",
          shadowOpacity: 0.2,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.onBrand }} />
        <Text style={{ flex: 1, color: colors.onBrand, fontSize: 13.5, fontWeight: "700" }} numberOfLines={1}>
          {activeRoute.code} in progress · {activeRoute.progress.done}/{activeRoute.progress.total} stops
        </Text>
        <Text style={{ color: colors.onBrand, fontSize: 16, fontWeight: "800" }}>›</Text>
      </Pressable>
    </View>
  );
}
