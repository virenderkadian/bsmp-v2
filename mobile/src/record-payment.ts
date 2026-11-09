import { api, ApiError } from "./api";
import { enqueuePayment, newPaymentId } from "./payment-queue";
import { todayStr } from "./local-date";
import { isOnline } from "./sync";

// Records a payment taken at the door, or queues it when there is no signal.
// Shared by every screen that can collect so there is one path, and one place
// that guarantees a retry can never record the money twice (the paymentId is
// generated once here and becomes the payment's primary key on the server).
export async function recordOrQueuePayment(input: {
  routeId: string;
  customerId: string;
  customerName: string;
  amount: number;
  mode: "CASH" | "UPI";
}): Promise<{ queued: boolean }> {
  const request = {
    paymentId: newPaymentId(),
    customerId: input.customerId,
    amount: input.amount,
    mode: input.mode,
    paidOn: todayStr(),
  };

  let queued = false;
  if (await isOnline()) {
    try {
      await api.recordPayment(input.routeId, request);
    } catch (err) {
      // A real server answer (validation, auth) is surfaced; only "couldn't
      // reach the server" falls back to the queue.
      if (err instanceof ApiError && err.status !== 0) throw err;
      queued = true;
    }
  } else {
    queued = true;
  }

  if (queued) await enqueuePayment(input.routeId, input.customerName, request);
  return { queued };
}
