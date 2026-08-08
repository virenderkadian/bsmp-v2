import AsyncStorage from "@react-native-async-storage/async-storage";

// A route is finished only when the driver explicitly says so — never inferred
// from "every stop has a saved line". Inferring it was wrong in practice: a
// route whose monthly sequence is short (or only partly filled in) would
// report itself complete after a couple of entries, while the driver still
// had real customers to visit.
//
// Deliberately LOCAL-ONLY, like cash-sale.ts: the delivery lines themselves
// are server data, but this "I'm done for today" marker is a driver-workflow
// convenience, so it never leaves the device and the web app has no notion of
// it. Trade-off to be aware of: a reinstall, a different phone, or the same
// vehicle signed in elsewhere all start with no completion marker.
//
// Scoped by route + date, so every route automatically starts fresh each day
// without any caller having to reset anything.

const STORAGE_KEY = "bsmp.driver.routeCompletions";
const RETENTION_DAYS = 7;

export type RouteCompletion = {
  routeId: string;
  date: string; // YYYY-MM-DD, same format as todayStr()
  completedAt: string; // ISO timestamp
};

function keyFor(routeId: string, date: string): string {
  return `${routeId}:${date}`;
}

async function readAll(): Promise<RouteCompletion[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RouteCompletion[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(entries: RouteCompletion[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function pruneExpired(entries: RouteCompletion[]): RouteCompletion[] {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return entries.filter((entry) => new Date(entry.completedAt).getTime() >= cutoff);
}

export async function markRouteCompleted(routeId: string, date: string): Promise<void> {
  const entries = pruneExpired(await readAll()).filter(
    (entry) => keyFor(entry.routeId, entry.date) !== keyFor(routeId, date),
  );
  entries.push({ routeId, date, completedAt: new Date().toISOString() });
  await writeAll(entries);
}

// Undo a completion — the driver tapped Finish by mistake, or a stop still
// needs correcting. Without this, an explicit-only completion would be a
// one-way door for the rest of the day.
export async function reopenRoute(routeId: string, date: string): Promise<void> {
  const entries = await readAll();
  await writeAll(entries.filter((entry) => keyFor(entry.routeId, entry.date) !== keyFor(routeId, date)));
}

export async function isRouteCompleted(routeId: string, date: string): Promise<boolean> {
  const entries = await readAll();
  return entries.some((entry) => entry.routeId === routeId && entry.date === date);
}

// Also persists the pruned list back — same reasoning as cash-sale.ts:
// pruning only on write would leave expired rows sitting there whenever
// nothing new gets marked for a while.
export async function getCompletedRouteIds(date: string): Promise<Set<string>> {
  const entries = pruneExpired(await readAll());
  await writeAll(entries);
  return new Set(entries.filter((entry) => entry.date === date).map((entry) => entry.routeId));
}
