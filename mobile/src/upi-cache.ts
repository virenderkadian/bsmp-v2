import AsyncStorage from "@react-native-async-storage/async-storage";

// The city's UPI payee, remembered on the phone.
//
// It reaches the app inside server responses (the delivery sheet, the dues
// list), but the scan code is needed at the door, which is exactly where
// signal is worst, and a server that does not send it yet would otherwise
// silently turn "Collect payment" into cash-only. Whenever the app sees the
// payee it keeps a copy; collecting falls back to that copy.
//
// Only ever a convenience: if it is missing the form degrades to cash-only,
// it never blocks recording a payment.

const STORAGE_KEY = "bsmp.driver.upiPayee";

export type UpiPayee = { upiId: string; payeeName: string };

export async function saveUpi(upi: UpiPayee | null | undefined): Promise<void> {
  if (!upi?.upiId) return;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(upi));
  } catch {
    // Not worth surfacing.
  }
}

export async function loadUpi(): Promise<UpiPayee | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UpiPayee;
    return parsed.upiId ? parsed : null;
  } catch {
    return null;
  }
}
