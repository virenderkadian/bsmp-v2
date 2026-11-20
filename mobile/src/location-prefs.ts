import AsyncStorage from "@react-native-async-storage/async-storage";

// Two small on-phone settings for the "Update saved location?" check:
//
//  - a switch (Profile) for the whole check, on by default. Off means a
//    delivery never asks; a customer with NO saved location is still filled in
//    silently on their first delivery, since that shows no prompt at all.
//  - a per-customer snooze: after "Keep saved" the same customer isn't asked
//    again for a week, unless their saved location has since changed.
//
// Stored on the phone, not the server: it needs no migration, works offline,
// and the worst case of a second phone not knowing is one extra prompt.

const CHECK_KEY = "bsmp.driver.checkSavedLocation";
const SNOOZE_KEY = "bsmp.driver.locationSnooze";
export const SNOOZE_DAYS = 7;

export async function getCheckSavedLocation(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CHECK_KEY)) !== "off";
  } catch {
    return true;
  }
}

export async function setCheckSavedLocation(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(CHECK_KEY, on ? "on" : "off");
  } catch {
    // Best effort — the switch simply won't stick.
  }
}

// customerId -> when the snooze ends (ms) and which saved point it was for.
type Snoozes = Record<string, { until: number; latitude: string; longitude: string }>;

async function readSnoozes(): Promise<Snoozes> {
  try {
    const raw = await AsyncStorage.getItem(SNOOZE_KEY);
    return raw ? (JSON.parse(raw) as Snoozes) : {};
  } catch {
    return {};
  }
}

// Snoozed only while the snooze hasn't ended AND the saved location is still
// the one the driver chose to keep (the office, or another driver, may have
// moved it since).
export async function isLocationSnoozed(customerId: string, latitude: string, longitude: string): Promise<boolean> {
  const entry = (await readSnoozes())[customerId];
  return !!entry && entry.until > Date.now() && entry.latitude === latitude && entry.longitude === longitude;
}

export async function snoozeLocationCheck(customerId: string, latitude: string, longitude: string): Promise<void> {
  try {
    const now = Date.now();
    const snoozes = await readSnoozes();
    // Drop entries that have run out, so the map never grows without bound.
    for (const [id, entry] of Object.entries(snoozes)) {
      if (entry.until <= now) delete snoozes[id];
    }
    snoozes[customerId] = { until: now + SNOOZE_DAYS * 24 * 60 * 60 * 1000, latitude, longitude };
    await AsyncStorage.setItem(SNOOZE_KEY, JSON.stringify(snoozes));
  } catch {
    // Best effort.
  }
}

export async function clearLocationSnooze(customerId: string): Promise<void> {
  try {
    const snoozes = await readSnoozes();
    if (snoozes[customerId]) {
      delete snoozes[customerId];
      await AsyncStorage.setItem(SNOOZE_KEY, JSON.stringify(snoozes));
    }
  } catch {
    // Best effort.
  }
}
