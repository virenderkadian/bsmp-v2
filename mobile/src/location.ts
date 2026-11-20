import * as Location from "expo-location";
import { Alert, Linking, Platform } from "react-native";
import { clearLocationSnooze, getCheckSavedLocation, isLocationSnoozed, snoozeLocationCheck } from "@/location-prefs";

// 8s was too long in practice: on a round the driver stares at an unresponsive
// screen while it runs. Location is a bonus, not a requirement — the delivery
// saves either way — so give up sooner and let them get on.
//
// Deliberately NOT served from getLastKnownPositionAsync: a cached fix taken a
// minute earlier can be hundreds of metres back down the road on a moving
// vehicle, and this value gets written to the customer's saved address.
const FIX_TIMEOUT_MS = 5000;

// A phone reports how far off a fix may be (`accuracy`, metres). A fix worse
// than these is mostly noise: the old check ignored it, so a phone reading
// "±40m" kept looking 12m+ away from a correct address and asked every time.
// Saving a customer's FIRST location tolerates a little more than comparing
// against an existing one, because without it there is nothing saved at all.
const MAX_ACCURACY_TO_SAVE_M = 40;
const MAX_ACCURACY_TO_COMPARE_M = 25;

// Best-effort GPS fix for backfilling a customer's location on delivery (see
// saveDriverLine on the backend). Never throws and never blocks a save for
// long: denied permission, a timeout, or any device error all resolve to
// null so the delivery still gets recorded — capturing the address is a
// bonus, not a requirement.
export async function tryGetCurrentLocation(): Promise<{ latitude: number; longitude: number; accuracy: number | null } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      return null;
    }

    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
    ]);
    if (!fix) {
      return null;
    }
    return { latitude: fix.coords.latitude, longitude: fix.coords.longitude, accuracy: fix.coords.accuracy ?? null };
  } catch {
    return null;
  }
}

// Used by the live map view to get `showsUserLocation` working without
// waiting for a delivery save to first trigger the permission prompt (the
// map may be the very first thing a driver opens on a route).
export async function ensureForegroundLocationPermission(): Promise<boolean> {
  try {
    const existing = await Location.getForegroundPermissionsAsync();
    if (existing.status === "granted") return true;
    const requested = await Location.requestForegroundPermissionsAsync();
    return requested.status === "granted";
  } catch {
    return false;
  }
}

// Mirrors the server-side threshold/check in src/lib/driver-data.ts
// (LOCATION_DRIFT_THRESHOLD_METERS) — used here only to decide whether to
// bother the driver with a prompt; the backend re-verifies independently
// before actually overwriting anything, so this copy drifting slightly out
// of sync would only affect prompt frequency, never correctness. Keep the
// client's prompt distance at or above the server's, or an accepted prompt
// would be refused there.
const LOCATION_DRIFT_THRESHOLD_METERS = 35;

function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const EARTH_RADIUS_METERS = 6371000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function confirmAsync(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Keep saved", style: "cancel", onPress: () => resolve(false) },
      { text: "Update", onPress: () => resolve(true) },
    ]);
  });
}

export type LocationSaveFields = {
  location?: { latitude: number; longitude: number };
  confirmLocationUpdate?: boolean;
};

// Resolves what to send along with a delivery save. Never throws; a failed or
// poor fix, a switched-off check, a snooze or a "keep saved" answer all just
// mean nothing location-related gets sent.
//
//  - No saved location yet: backfill silently from a fix that is accurate enough.
//  - A saved location: only if the check is on, this customer isn't snoozed, and
//    the fix is accurate (<=25m) AND clearly further from the saved point than
//    both the usual drift (35m) and twice its own error — then ask. "Keep saved"
//    snoozes that customer for a week.
export async function resolveLocationForSave(
  customerId: string,
  savedLatitude: string | null,
  savedLongitude: string | null,
): Promise<LocationSaveFields> {
  const hasSaved = !!savedLatitude && !!savedLongitude;

  // Decide before touching GPS, so a check that can't matter costs no wait.
  if (hasSaved) {
    if (!(await getCheckSavedLocation())) return {};
    if (await isLocationSnoozed(customerId, savedLatitude, savedLongitude)) return {};
  }

  const fix = await tryGetCurrentLocation();
  if (!fix) {
    return {};
  }
  const accuracy = fix.accuracy;
  const location = { latitude: fix.latitude, longitude: fix.longitude };

  if (!hasSaved) {
    // Unknown accuracy (null) is let through, as before; a clearly poor fix is not.
    if (accuracy !== null && accuracy > MAX_ACCURACY_TO_SAVE_M) return {};
    return { location };
  }

  if (accuracy === null || accuracy > MAX_ACCURACY_TO_COMPARE_M) {
    return {};
  }
  const distance = haversineDistanceMeters(Number(savedLatitude), Number(savedLongitude), fix.latitude, fix.longitude);
  if (distance <= Math.max(LOCATION_DRIFT_THRESHOLD_METERS, accuracy * 2)) {
    return {};
  }

  const confirmed = await confirmAsync(
    "Update saved location?",
    `Your location is about ${Math.round(distance)}m from this customer's saved address. Update it?`,
  );
  if (confirmed) {
    await clearLocationSnooze(customerId);
    return { location, confirmLocationUpdate: true };
  }
  await snoozeLocationCheck(customerId, savedLatitude, savedLongitude);
  return {};
}

// Turn-by-turn directions to a saved customer location.
//   iOS: lets the driver choose Apple Maps or Google Maps (comgooglemaps://,
//        falling back to the universal web link if Google Maps isn't
//        installed).
//   Android: opens Google Maps directly (google.navigation: targets that app
//        specifically, rather than a generic geo: URI that lets Android pick
//        any installed maps app).
export function openNavigation(latitude: number, longitude: number): void {
  const webFallback = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  const openWithFallback = (url: string) => {
    Linking.openURL(url).catch(() => {
      Linking.openURL(webFallback).catch(() => undefined);
    });
  };

  if (Platform.OS === "android") {
    openWithFallback(`google.navigation:q=${latitude},${longitude}`);
    return;
  }

  if (Platform.OS === "ios") {
    Alert.alert("Navigate with", undefined, [
      { text: "Apple Maps", onPress: () => openWithFallback(`maps://app?daddr=${latitude},${longitude}&dirflg=d`) },
      {
        text: "Google Maps",
        onPress: () => openWithFallback(`comgooglemaps://?daddr=${latitude},${longitude}&directionsmode=driving`),
      },
      { text: "Cancel", style: "cancel" },
    ]);
    return;
  }

  openWithFallback(webFallback);
}
