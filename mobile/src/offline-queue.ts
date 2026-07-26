import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DriverSaveLineRequest } from "@shared/driver-api-types";

// Local queue for delivery marks made with no connectivity (or after a
// network attempt genuinely fails). Pure storage — see src/sync.ts for the
// engine that actually replays these against the real API.

const STORAGE_KEY = "bsmp.driver.offlineQueue";

export type QueuedSave = {
  // routeId:customerId:date — stable and deliberately NOT random: re-queueing
  // the same stop (the driver edits a not-yet-synced delivery) replaces the
  // earlier entry instead of piling up duplicates, mirroring the real
  // save-line endpoint's own upsert-by-stop semantics.
  id: string;
  routeId: string;
  customerId: string;
  request: DriverSaveLineRequest;
  queuedAt: string;
  attempts: number;
  lastError?: string;
};

function keyFor(routeId: string, customerId: string, date: string): string {
  return `${routeId}:${customerId}:${date}`;
}

async function readAll(): Promise<QueuedSave[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedSave[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(items: QueuedSave[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export async function enqueueSave(routeId: string, customerId: string, request: DriverSaveLineRequest): Promise<void> {
  const items = await readAll();
  const id = keyFor(routeId, customerId, request.date);
  const next = items.filter((item) => item.id !== id);
  next.push({ id, routeId, customerId, request, queuedAt: new Date().toISOString(), attempts: 0 });
  await writeAll(next);
}

export async function getAllQueued(): Promise<QueuedSave[]> {
  return readAll();
}

export async function getQueueForRoute(routeId: string): Promise<QueuedSave[]> {
  return (await readAll()).filter((item) => item.routeId === routeId);
}

export async function removeFromQueue(id: string): Promise<void> {
  const items = await readAll();
  await writeAll(items.filter((item) => item.id !== id));
}

export async function markAttemptFailed(id: string, error: string): Promise<void> {
  const items = await readAll();
  const updated = items.map((item) => (item.id === id ? { ...item, attempts: item.attempts + 1, lastError: error } : item));
  await writeAll(updated);
}
