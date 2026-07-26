import * as Location from "expo-location";
import { Linking, Platform } from "react-native";

const FIX_TIMEOUT_MS = 8000;

// Best-effort GPS fix for backfilling a customer's location on first delivery
// (see saveDriverLine on the backend). Never throws and never blocks a save
// for long: denied permission, a timeout, or any device error all resolve to
// null so the delivery still gets recorded — capturing the address is a
// bonus, not a requirement.
export async function tryGetCurrentLocation(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      return null;
    }

    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
    ]);
    if (!fix) {
      return null;
    }
    return { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
  } catch {
    return null;
  }
}

// Turn-by-turn directions to a saved customer location — Apple Maps on iOS,
// Google Maps specifically on Android (google.navigation: targets that app
// directly, rather than a generic geo: URI that lets Android pick any
// installed maps app). Falls back to a universal web link if the native
// scheme can't be opened (app not installed, scheme blocked, etc.).
export function openNavigation(latitude: number, longitude: number): void {
  const webFallback = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  const url =
    Platform.OS === "ios"
      ? `maps://app?daddr=${latitude},${longitude}&dirflg=d`
      : Platform.OS === "android"
        ? `google.navigation:q=${latitude},${longitude}`
        : webFallback;

  Linking.openURL(url).catch(() => {
    Linking.openURL(webFallback).catch(() => undefined);
  });
}
