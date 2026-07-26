import { usePathname, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useActiveRoute } from "@/active-route";
import { radius } from "@/theme";
import { useColors } from "@/ui";

// A persistent, tappable reminder that a route is mid-delivery — visible on
// every screen (Dashboard/Delivery/Profile, or the app cold-started back into
// the tabs) except the run screen for that exact route, where it'd just be
// pointing at the screen you're already on. Tapping it re-opens the run
// screen, which reconstructs the correct current stop purely from server data
// (saved lines), so it resumes in the right place with no client-side session
// state to go stale.
//
// Placed near the TOP of the screen rather than floating above the tab bar:
// NativeTabs renders a genuine native tab bar (UITabBar / Material bar), and
// a JS overlay isn't guaranteed to sit reliably above that native layer. A
// top banner sidesteps the question entirely, since the tab bar always lives
// at the bottom.
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
    <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
      <Pressable
        onPress={() => router.push(`/run/${activeRoute.id}`)}
        style={({ pressed }) => ({
          marginTop: insets.top + 6,
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
