import AsyncStorage from "@react-native-async-storage/async-storage";
import { localDateStr } from "./local-date";
import type { CashSaleEntry, CashSaleItem, CashSaleSessionTotals } from "./cash-sale-types";

export type { CashSaleEntry, CashSaleItem, CashSaleSessionTotals } from "./cash-sale-types";

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
// everything under a date cutoff; under this they still have their recent
// rounds, and storage still can't grow without bound.
//
// Six, not two. Every vehicle in service runs exactly two routes a day
// (a morning and an evening round), so a retention of two spent the entire
// budget on a single normal day. The moment a third session existed — the
// driver opening yesterday's round to check a figure, or a round straddling
// midnight — a LIVE session was evicted mid-round. Six leaves the last three
// days of rounds intact, so eviction can never reach the day being worked.

const STORAGE_KEY = "bsmp.driver.cashSales";
const RETENTION_SESSIONS = 6;

function sessionDateOf(entry: CashSaleEntry): string {
  // The fallback reads createdAt in LOCAL time, matching todayStr(). Slicing
  // the ISO string instead would read it as UTC and misfile any sale recorded
  // before 05:30 local under the previous day.
  return entry.sessionDate ?? localDateStr(new Date(entry.createdAt));
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

// Every read-modify-write of the store runs through here, one at a time.
//
// AsyncStorage has no transactions, so two overlapping read-modify-writes
// race: the loser writes back a snapshot taken before the winner's change and
// silently erases it. That is how a cash sale could vanish moments after being
// saved — the run screen and the sale sheet both touch this store, and the run
// screen re-reads exactly when the sheet closes, right after a save.
let tail: Promise<unknown> = Promise.resolve();

function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  // Chained off the previous operation's settlement, so one failure can't
  // wedge the queue for everything after it.
  const next = tail.then(operation, operation);
  tail = next.catch(() => undefined);
  return next;
}

// Keeps the newest RETENTION_SESSIONS sessions and drops the rest, so old
// rounds can't accumulate on the device indefinitely.
//
// "Newest" means the round's own DATE, not when the sale happened to be typed
// in. Ranking by createdAt let a sale entered late for an earlier round make
// that round look newer than the one being worked, and evict it. createdAt
// only breaks ties between two rounds on the same date.
function pruneExpired(entries: CashSaleEntry[]): CashSaleEntry[] {
  const sessions = new Map<string, { date: string; at: number }>();
  entries.forEach((entry) => {
    const key = sessionKeyOf(entry);
    const at = new Date(entry.createdAt).getTime();
    const current = sessions.get(key);
    sessions.set(key, {
      date: sessionDateOf(entry),
      at: Math.max(current?.at ?? 0, Number.isNaN(at) ? 0 : at),
    });
  });

  const keep = new Set(
    [...sessions.entries()]
      .sort(([, left], [, right]) => (left.date === right.date ? right.at - left.at : right.date.localeCompare(left.date)))
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
  return exclusive(async () => {
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
  });
}

// Sales for ONE session (this route, this date), newest first.
//
// Reading NEVER writes. It used to persist the pruned list back on every
// read, which made a plain read a destructive operation: it both raced with
// concurrent saves and permanently deleted evicted sessions rather than just
// hiding them. Expired sessions are dropped from the returned view here and
// removed from storage on the next write, which is enough to bound growth.
export async function getCashSaleEntries(routeId: string, sessionDate: string): Promise<CashSaleEntry[]> {
  const entries = pruneExpired(await readAll());
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.routeId === routeId && sessionDateOf(entry) === sessionDate)
    // Newest first. Two sales can share a timestamp, so stored order breaks
    // the tie — later in the file means recorded later.
    .sort((left, right) => right.entry.createdAt.localeCompare(left.entry.createdAt) || right.index - left.index)
    .map(({ entry }) => entry);
}

// Product-wise quantity and amount for one session, plus its overall total —
// what the driver reads off at the end of a round.
export function summariseCashSales(entries: CashSaleEntry[]): CashSaleSessionTotals {
  const products = new Map<
    string,
    { productId: string; code: string; name?: string; unit: string; quantity: number; amount: number }
  >();

  entries.forEach((entry) => {
    entry.items.forEach((item) => {
      const current =
        products.get(item.productId) ??
        { productId: item.productId, code: item.code, name: item.name, unit: item.unit, quantity: 0, amount: 0 };
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
  return exclusive(async () => {
    const entries = await readAll();
    await writeAll(entries.filter((entry) => entry.id !== id));
  });
}
