import { Redirect } from "expo-router";
// Native tab bar — real UITabBar on iOS (liquid glass on iOS 26) and the native
// Material tab bar on Android. This is Expo Router's native-tabs API (SDK 54+).
// If your Expo version exposes it under a different path, adjust this import.
// Android `drawable` names refer to Android drawable resources; swap them for
// your own vector drawables (or a VectorIcon) if these system names aren't found.
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "@/session";
import { useColors } from "@/ui";

export default function TabsLayout() {
  const { loading, token } = useSession();
  const colors = useColors();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ground, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (!token) {
    return <Redirect href="/login" />;
  }

  return (
    // tintColor: the selected tab otherwise falls back to iOS system blue, which
    // clashes with the theme (clearly so in light mode).
    <NativeTabs tintColor={colors.brand}>
      <NativeTabs.Trigger name="index">
        <Label>Dashboard</Label>
        <Icon sf="chart.bar.fill" drawable="ic_menu_today" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="delivery">
        <Label>Delivery</Label>
        <Icon sf="shippingbox.fill" drawable="ic_menu_share" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Label>Profile</Label>
        <Icon sf="person.fill" drawable="ic_menu_myplaces" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
