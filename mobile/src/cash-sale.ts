import AsyncStorage from "@react-native-async-storage/async-storage";

// Cash sale is deliberately NOT part of the server API — no DailyRouteEntry,
// no billing, nothing in the web app's database. It's a fast local scratchpad
// for the driver's own tracking during a round.
//
// Scoped to a SESSION: one route on one date, the same unit route completion
// uses. A sale belongs to the round it was made on, so the driver reads back
// "what did I sell on this run" rather than a rolling two-day mixture that
// spans routes and days.
//
// Retention keeps the most recent RETENTION_SESSIONS sessions rather than a
// fixed number of days. A driver who doesn't run for three days would lose
// everything under a date cutoff; under this they still have their last two
// rounds, and storage still can't grow without bound.

const STORAGE_KEY = "bsmp.driver.cashSales";
const RETENTION_SESSIONS = 2;

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
  // YYYY-MM-DD. Which round this sale belongs to, alongside routeId. Entries
  // written before sessions existed have no value here, so readers derive it
  // from createdAt — see sessionDateOf.
  sessionDate?: string;
  createdAt: string; // ISO timestamp
  items: CashSaleItem[];
  totalAmount: number;
};

export type CashSaleSessionTotals = {
  entryCount: number;
  totalAmount: number;
  products: Array<{ productId: string; code: string; unit: string; quantity: number; amount: number }>;
};

function sessionDateOf(entry: CashSaleEntry): string {
  return entry.sessionDate ?? entry.createdAt.slice(0, 10);
}

function sessionKeyOf(entry: CashSaleEntry): string {
  return `${entry.routeId}:${sessionDateOf(entry)}`;
}

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

// Keeps the newest RETENTION_SESSIONS sessions and drops the rest, so old
// rounds can't accumulate on the device indefinitely.
function pruneExpired(entries: CashSaleEntry[]): CashSaleEntry[] {
  const newestBySession = new Map<string, number>();
  entries.forEach((entry) => {
    const at = new Date(entry.createdAt).getTime();
    const key = sessionKeyOf(entry);
    newestBySession.set(key, Math.max(newestBySession.get(key) ?? 0, at));
  });

  const keep = new Set(
    [...newestBySession.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, RETENTION_SESSIONS)
      .map(([key]) => key),
  );

  return entries.filter((entry) => keep.has(sessionKeyOf(entry)));
}

export async function addCashSaleEntry(
  routeId: string,
  sessionDate: string,
  items: CashSaleItem[],
): Promise<CashSaleEntry> {
  const entries = pruneExpired(await readAll());
  const entry: CashSaleEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    routeId,
    sessionDate,
    createdAt: new Date().toISOString(),
    items,
    totalAmount: items.reduce((sum, item) => sum + item.amount, 0),
  };
  entries.push(entry);
  await writeAll(entries);
  return entry;
}

// Sales for ONE session (this route, this date), newest first.
//
// Also persists the pruned list back, so storage doesn't quietly keep expired
// rows around between reads — pruning only on write would leave them sitting
// there whenever nothing new gets added.
export async function getCashSaleEntries(routeId: string, sessionDate: string): Promise<CashSaleEntry[]> {
  const entries = pruneExpired(await readAll());
  await writeAll(entries);
  return entries
    .filter((entry) => entry.routeId === routeId && sessionDateOf(entry) === sessionDate)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Product-wise quantity and amount for one session, plus its overall total —
// what the driver reads off at the end of a round.
export function summariseCashSales(entries: CashSaleEntry[]): CashSaleSessionTotals {
  const products = new Map<string, { productId: string; code: string; unit: string; quantity: number; amount: number }>();

  entries.forEach((entry) => {
    entry.items.forEach((item) => {
      const current =
        products.get(item.productId) ??
        { productId: item.productId, code: item.code, unit: item.unit, quantity: 0, amount: 0 };
      current.quantity += item.quantity;
      current.amount += item.amount;
      products.set(item.productId, current);
    });
  });

  return {
    entryCount: entries.length,
    totalAmount: entries.reduce((sum, entry) => sum + entry.totalAmount, 0),
    products: [...products.values()].sort((left, right) => left.code.localeCompare(right.code)),
  };
}

export async function deleteCashSaleEntry(id: string): Promise<void> {
  const entries = await readAll();
  await writeAll(entries.filter((entry) => entry.id !== id));
}
