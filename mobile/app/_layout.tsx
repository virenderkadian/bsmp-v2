import "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ActiveRouteProvider } from "@/active-route";
import { ActiveRoutePill } from "@/components/ActiveRoutePill";
import { SessionProvider } from "@/session";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SessionProvider>
          <ActiveRouteProvider>
            <StatusBar style="auto" />
            {/* ActiveRoutePill is a sibling after Stack, not inside any one
                screen, so it floats over every tab and pushed screen alike. */}
            <View style={{ flex: 1 }}>
              <Stack screenOptions={{ headerShown: false }} />
              {/* Routes (tabs), login, and run/* are auto-registered by Expo Router. */}
              <ActiveRoutePill />
            </View>
          </ActiveRouteProvider>
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
