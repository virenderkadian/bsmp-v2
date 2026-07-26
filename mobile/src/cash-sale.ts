import AsyncStorage from "@react-native-async-storage/async-storage";

// Cash sale is deliberately NOT part of the server API — no DailyRouteEntry,
// no billing, nothing in the web app's database. It's a fast local scratchpad
// for the driver's own tracking during the day (e.g. to read a total off to
// the office), and it self-cleans: only the last RETENTION_DAYS days are ever
// kept on the device.

const STORAGE_KEY = "bsmp.driver.cashSales";
const RETENTION_DAYS = 2;

export type CashSaleItem = {
  productId: string;
  code: string;
  unit: string;
  rate: number;
  quantity: number;
  amount: number;
};

export type CashSaleEntry = {
  id: string;
  routeId: string;
  createdAt: string; // ISO timestamp
  items: CashSaleItem[];
  totalAmount: number;
};

async function readAll(): Promise<CashSaleEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CashSaleEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(entries: CashSaleEntry[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function pruneExpired(entries: CashSaleEntry[]): CashSaleEntry[] {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return entries.filter((entry) => new Date(entry.createdAt).getTime() >= cutoff);
}

export async function addCashSaleEntry(routeId: string, items: CashSaleItem[]): Promise<CashSaleEntry> {
  const entries = pruneExpired(await readAll());
  const entry: CashSaleEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    routeId,
    createdAt: new Date().toISOString(),
    items,
    totalAmount: items.reduce((sum, item) => sum + item.amount, 0),
  };
  entries.push(entry);
  await writeAll(entries);
  return entry;
}

// Also persists the pruned list back, so storage doesn't quietly keep
// expired rows around between reads (pruning only on write would leave them
// sitting there if nothing gets added for a while).
export async function getCashSaleEntries(routeId: string): Promise<CashSaleEntry[]> {
  const entries = pruneExpired(await readAll());
  await writeAll(entries);
  return entries.filter((entry) => entry.routeId === routeId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteCashSaleEntry(id: string): Promise<void> {
  const entries = await readAll();
  await writeAll(entries.filter((entry) => entry.id !== id));
}
