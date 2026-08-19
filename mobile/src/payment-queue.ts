import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import type { DriverPaymentRequest } from "@shared/driver-api-types";

// Payments taken at the door that haven't reached the server yet.
//
// Kept separate from the delivery queue (offline-queue.ts) on purpose. A
// delivery can be replayed freely because it upserts on entry+customer, so the
// worst case is a redundant write. A payment has no such natural key: replaying
// it carelessly would take the customer's money twice. Every payment therefore
// carries a client-generated UUID that becomes its primary key server-side, and
// an entry only leaves this queue once the server has confirmed that id.
//
// The consequence worth stating plainly: an item may be sent more than once,
// and that is SAFE. It must never be recorded more than once.

const STORAGE_KEY = "bsmp.driver.paymentQueue";

// A v4 UUID, the format the endpoint validates.
//
// Backed by the device's secure random source via expo-crypto. Not
// crypto.randomUUID: that global isn't reliably present across React Native
// runtimes, and it failing here would mean failing with a customer's cash
// already in hand.
//
// The Math.random fallback exists for exactly that reason — this must never be
// the thing that stops a payment being recorded. It's weaker, but adequate for
// what this value actually is: an idempotency key that only has to be unique
// among payments from one phone, not a secret. Nothing is gained by guessing
// one, since the endpoint still requires a valid driver token.
export function newPaymentId(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
      const random = (Math.random() * 16) | 0;
      const value = char === "x" ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }
}

export type QueuedPayment = {
  routeId: string;
  request: DriverPaymentRequest;
  queuedAt: string;
  attempts: number;
  lastError?: string;
  customerName: string;
};

async function readAll(): Promise<QueuedPayment[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedPayment[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(items: QueuedPayment[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

// Keyed by the payment's own id, so enqueueing the same payment twice (a
// double tap, a retry after an ambiguous failure) replaces rather than adds.
export async function enqueuePayment(
  routeId: string,
  customerName: string,
  request: DriverPaymentRequest,
): Promise<void> {
  const items = await readAll();
  const next = items.filter((item) => item.request.paymentId !== request.paymentId);
  next.push({ routeId, request, customerName, queuedAt: new Date().toISOString(), attempts: 0 });
  await writeAll(next);
}

export async function getQueuedPayments(): Promise<QueuedPayment[]> {
  return readAll();
}

export async function getQueuedPaymentsForRoute(routeId: string): Promise<QueuedPayment[]> {
  return (await readAll()).filter((item) => item.routeId === routeId);
}

export async function removeQueuedPayment(paymentId: string): Promise<void> {
  const items = await readAll();
  await writeAll(items.filter((item) => item.request.paymentId !== paymentId));
}

export async function markPaymentAttemptFailed(paymentId: string, error: string): Promise<void> {
  const items = await readAll();
  await writeAll(
    items.map((item) =>
      item.request.paymentId === paymentId
        ? { ...item, attempts: item.attempts + 1, lastError: error }
        : item,
    ),
  );
}
