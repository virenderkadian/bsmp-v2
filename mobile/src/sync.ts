import NetInfo from "@react-native-community/netinfo";
import { api, ApiError } from "@/api";
import { getAllQueued, markAttemptFailed, removeFromQueue } from "@/offline-queue";
import {
  getQueuedPayments,
  markPaymentAttemptFailed,
  removeQueuedPayment,
} from "@/payment-queue";

type FailedSave = { id: string; routeId: string; customerId: string; error: string };

export type SyncResult = {
  synced: string[];
  // The server responded and refused (a locked bill, a stale product). Retrying
  // will never succeed, so these need a person to look at them.
  rejected: FailedSave[];
  // Never reached the server. Still queued and will go again by itself, so
  // these must NOT be reported as failures — on a route with patchy signal
  // that's the normal case, and alerting on it buries the real rejections.
  retrying: FailedSave[];
};

// `isInternetReachable` is `null` ("unknown") on some platforms/timings —
// only a hard `false` counts as offline, so a momentarily-unknown reading
// doesn't wrongly force everything into the queue.
export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return Boolean(state.isConnected) && state.isInternetReachable !== false;
}

let flushInFlight: Promise<SyncResult> | null = null;

// Replays every queued save against the real API, oldest first. Each item is
// independent — one failing (e.g. its bill got locked before it synced)
// doesn't block the rest. Concurrent callers share one in-flight run rather
// than double-submitting the same queue.
export async function flushOfflineQueue(): Promise<SyncResult> {
  if (flushInFlight) {
    return flushInFlight;
  }
  flushInFlight = (async () => {
    const items = await getAllQueued();
    const result: SyncResult = { synced: [], rejected: [], retrying: [] };
    for (const item of items) {
      try {
        await api.saveLine(item.routeId, item.customerId, item.request);
        await removeFromQueue(item.id);
        result.synced.push(item.id);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Sync failed.";
        // status 0 is this app's convention for "never reached the server"
        // (see api.ts) — a real network failure, worth retrying later. Any
        // other status means the server responded and rejected it (e.g. the
        // bill got locked before this synced); retrying won't change that
        // outcome, so drop it instead of retrying forever and silently.
        const isPermanentRejection = err instanceof ApiError && err.status !== 0;
        const failure = { id: item.id, routeId: item.routeId, customerId: item.customerId, error: message };
        if (isPermanentRejection) {
          await removeFromQueue(item.id);
          result.rejected.push(failure);
        } else {
          await markAttemptFailed(item.id, message);
          result.retrying.push(failure);
        }
      }
    }
    // Payments replay the same way, but the stakes differ: sending twice is
    // safe (the server upserts on the client-supplied payment id), recording
    // twice would not be. Nothing is removed from the queue until the server
    // has confirmed that id.
    const payments = await getQueuedPayments();
    for (const item of payments) {
      try {
        await api.recordPayment(item.routeId, item.request);
        await removeQueuedPayment(item.request.paymentId);
        result.synced.push(item.request.paymentId);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Sync failed.";
        const isPermanentRejection = err instanceof ApiError && err.status !== 0;
        const failure = {
          id: item.request.paymentId,
          routeId: item.routeId,
          customerId: item.request.customerId,
          error: `${item.customerName}: ${message}`,
        };
        if (isPermanentRejection) {
          // The server refused it outright. Retrying can't help, and leaving it
          // queued would mean a payment silently never lands — so drop it and
          // tell someone, since real money was collected.
          await removeQueuedPayment(item.request.paymentId);
          result.rejected.push(failure);
        } else {
          await markPaymentAttemptFailed(item.request.paymentId, message);
          result.retrying.push(failure);
        }
      }
    }

    return result;
  })();
  try {
    return await flushInFlight;
  } finally {
    flushInFlight = null;
  }
}
