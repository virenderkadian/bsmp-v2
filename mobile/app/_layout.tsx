import "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ActiveRouteProvider } from "@/active-route";
import { ActiveRoutePill } from "@/components/ActiveRoutePill";
import { OfflineSyncProvider } from "@/offline-sync-context";
import { SessionProvider } from "@/session";
import { ThemePreferenceProvider, useTheme } from "@/theme-preference";

// Split out so it can read the resolved theme (ThemePreferenceProvider must
// be an ancestor first) — the status bar icon style needs to match whichever
// scheme is actually active, not just the OS's, since a driver can override
// appearance independently of the device setting.
function AppShell() {
  const { scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      {/* ActiveRoutePill is a sibling after Stack, not inside any one screen,
          so it floats over every tab and pushed screen alike. */}
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false }} />
        {/* Routes (tabs), login, and run/* are auto-registered by Expo Router. */}
        <ActiveRoutePill />
      </View>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemePreferenceProvider>
          <SessionProvider>
            <ActiveRouteProvider>
              <OfflineSyncProvider>
                <AppShell />
              </OfflineSyncProvider>
            </ActiveRouteProvider>
          </SessionProvider>
        </ThemePreferenceProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
