import * as Location from "expo-location";
import { Alert, Linking, Platform } from "react-native";

// 8s was too long in practice: on a round the driver stares at an unresponsive
// screen while it runs. Location is a bonus, not a requirement — the delivery
// saves either way — so give up sooner and let them get on.
//
// Deliberately NOT served from getLastKnownPositionAsync: a cached fix taken a
// minute earlier can be hundreds of metres back down the road on a moving
// vehicle, and this value gets written to the customer's saved address.
const FIX_TIMEOUT_MS = 4000;

// Best-effort GPS fix for backfilling a customer's location on delivery (see
// saveDriverLine on the backend). Never throws and never blocks a save for
// long: denied permission, a timeout, or any device error all resolve to
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
// of sync would only affect prompt frequency, never correctness.
const LOCATION_DRIFT_THRESHOLD_METERS = 12;

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

// Resolves what to send along with a delivery save: always attempts a fresh
// GPS fix (skip entirely if the caller already knows this is a skip), then
// either backfills silently (customer has no saved location yet) or — if the
// new fix is more than ~12m from what's saved — prompts the driver before
// agreeing to move it. Never throws; a failed fix or a "keep saved" answer
// both just mean nothing location-related gets sent.
export async function resolveLocationForSave(
  savedLatitude: string | null,
  savedLongitude: string | null,
): Promise<LocationSaveFields> {
  const fix = await tryGetCurrentLocation();
  if (!fix) {
    return {};
  }

  if (!savedLatitude || !savedLongitude) {
    return { location: fix };
  }

  const distance = haversineDistanceMeters(Number(savedLatitude), Number(savedLongitude), fix.latitude, fix.longitude);
  if (distance <= LOCATION_DRIFT_THRESHOLD_METERS) {
    return {};
  }

  const confirmed = await confirmAsync(
    "Update saved location?",
    `Your location is about ${Math.round(distance)}m from this customer's saved address. Update it?`,
  );
  return confirmed ? { location: fix, confirmLocationUpdate: true } : {};
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
