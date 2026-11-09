import AsyncStorage from "@react-native-async-storage/async-storage";
import { todayStr } from "./local-date";

// Which customers this phone has already recorded a payment for today.
//
// Recorded payments sit as "pending" until the office verifies them, so the
// customer's unpaid amount does not change when the driver collects. Without a
// durable marker the screens would go on offering "Collect payment" for the
// same bill, and a second tap records the money twice. That is exactly how
// ₹38,899 was double-collected in September. The marker lives in storage, not
// component state, so it survives leaving the screen and restarting the app,
// and it is shared by every screen that can collect.
//
// A deliberate speed bump rather than a hard block: a customer can genuinely
// pay twice in a day, so the collect screen explains it and lets the driver
// confirm another payment on purpose.

const STORAGE_KEY = "bsmp.driver.paidToday";

type Stored = { date: string; customerIds: string[] };

async function read(): Promise<Stored> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Stored;
      // Yesterday's markers are meaningless today.
      if (parsed.date === todayStr() && Array.isArray(parsed.customerIds)) return parsed;
    }
  } catch {
    // Fall through to an empty set — a lost marker must never block collecting.
  }
  return { date: todayStr(), customerIds: [] };
}

export async function getPaidToday(): Promise<Set<string>> {
  return new Set((await read()).customerIds);
}

export async function markPaidToday(customerId: string): Promise<void> {
  const current = await read();
  if (current.customerIds.includes(customerId)) return;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ date: current.date, customerIds: [...current.customerIds, customerId] }));
  } catch {
    // The payment itself is already safe; only the reminder is lost.
  }
}
