"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentCityId } from "@/lib/current-city";
import { getCurrentUser } from "@/lib/current-user";
import { bulkOptIn, setCustomerConsent } from "@/lib/notifications/consent";
import { cancelPending, enqueueMonthlyBills, retryFailed, type SkippedCustomer } from "@/lib/notifications/outbox";
import { monthInputToDate } from "@/lib/monthly-route-sequence";

export type WhatsAppActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  skipped?: SkippedCustomer[];
};

const idleState: WhatsAppActionState = { status: "idle" };

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

// Queueing messages to customers is a money-adjacent, outward-facing act — the
// same class of thing as generating or locking a bill — so it is restricted to
// the roles that already own those decisions. A USER can run the day's
// operations; they cannot decide that two thousand customers get a message.
async function requireSendPermission(): Promise<void> {
  const user = await getCurrentUser();

  if (!user || (user.role !== "ADMIN" && user.role !== "SUPERADMIN")) {
    throw new Error("Only an admin can send WhatsApp messages to customers.");
  }
}

const queueBillsSchema = z.object({
  billingMonth: z.string().regex(/^\d{4}-\d{2}$/, "Select a valid month."),
});

export async function queueMonthlyBills(
  _prevState: WhatsAppActionState = idleState,
  formData: FormData,
): Promise<WhatsAppActionState> {
  void _prevState;

  const parsed = queueBillsSchema.safeParse({ billingMonth: getValue(formData, "billingMonth") });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  try {
    await requireSendPermission();
    const cityId = await getCurrentCityId();

    const result = await enqueueMonthlyBills({
      cityId,
      billingMonth: monthInputToDate(parsed.data.billingMonth),
    });

    revalidatePath("/whatsapp");

    if (result.queued === 0 && result.alreadyQueued === 0) {
      return {
        status: "error",
        message:
          result.skipped.length > 0
            ? `Nothing queued — all ${result.skipped.length} bill(s) were skipped. See the list below.`
            : "No generated bills found for that month.",
        skipped: result.skipped,
      };
    }

    const parts = [`Queued ${result.queued} message(s).`];
    if (result.alreadyQueued > 0) {
      parts.push(`${result.alreadyQueued} were already queued earlier.`);
    }
    if (result.skipped.length > 0) {
      parts.push(`${result.skipped.length} skipped.`);
    }

    return { status: "success", message: parts.join(" "), skipped: result.skipped };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to queue bill messages.",
    };
  }
}

export async function retryFailedMessages(
  _prevState: WhatsAppActionState = idleState,
  formData: FormData,
): Promise<WhatsAppActionState> {
  void _prevState;

  try {
    await requireSendPermission();
    const cityId = await getCurrentCityId();
    const batchId = getValue(formData, "batchId");

    const count = await retryFailed({ cityId, ...(batchId ? { batchId } : {}) });
    revalidatePath("/whatsapp");

    return {
      status: "success",
      message: count > 0 ? `Requeued ${count} message(s).` : "Nothing to retry.",
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to retry failed messages.",
    };
  }
}

export async function cancelBatch(
  _prevState: WhatsAppActionState = idleState,
  formData: FormData,
): Promise<WhatsAppActionState> {
  void _prevState;

  const batchId = getValue(formData, "batchId");

  if (!batchId) {
    return { status: "error", message: "Missing batch." };
  }

  try {
    await requireSendPermission();
    const cityId = await getCurrentCityId();

    const count = await cancelPending({ cityId, batchId });
    revalidatePath("/whatsapp");

    return {
      status: "success",
      message:
        count > 0
          ? `Cancelled ${count} unsent message(s). Anything already sent cannot be recalled.`
          : "Nothing left to cancel — this batch has finished sending.",
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to cancel the batch.",
    };
  }
}

export async function toggleConsent(
  _prevState: WhatsAppActionState = idleState,
  formData: FormData,
): Promise<WhatsAppActionState> {
  void _prevState;

  const customerId = getValue(formData, "customerId");
  const optIn = getValue(formData, "optIn") === "true";

  if (!customerId) {
    return { status: "error", message: "Missing customer." };
  }

  try {
    await requireSendPermission();
    const cityId = await getCurrentCityId();

    await setCustomerConsent({ cityId, customerId, optIn });
    revalidatePath("/whatsapp");

    return { status: "success", message: optIn ? "Opted in." : "Opted out." };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to update consent.",
    };
  }
}

export async function bulkOptInCustomers(
  _prevState: WhatsAppActionState = idleState,
  formData: FormData,
): Promise<WhatsAppActionState> {
  void _prevState;

  // A typed confirmation rather than a plain button: this records consent on
  // behalf of every customer at once, and it should not be reachable by a
  // mis-click.
  if (getValue(formData, "confirm").trim().toUpperCase() !== "OPT IN ALL") {
    return { status: "error", message: 'Type "OPT IN ALL" to confirm.' };
  }

  try {
    await requireSendPermission();
    const cityId = await getCurrentCityId();

    const count = await bulkOptIn(cityId);
    revalidatePath("/whatsapp");

    return {
      status: "success",
      message:
        count > 0
          ? `Opted in ${count} customer(s). Anyone who had opted out was left alone.`
          : "No customers needed opting in.",
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to opt customers in.",
    };
  }
}
