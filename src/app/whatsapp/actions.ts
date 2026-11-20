"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentCityId } from "@/lib/current-city";
import { getCurrentUser } from "@/lib/current-user";
import { bulkOptIn, setCustomerConsent } from "@/lib/notifications/consent";
import { enqueuePaymentReminders, planPaymentReminders } from "@/lib/notifications/reminders";
import { loadTemplates, submitOurTemplate, type TemplatesState } from "@/lib/notifications/template-admin";
import { cancelMessages, cancelPending, enqueueMonthlyBills, planMonthlyBills, retryFailed, type SkippedCustomer } from "@/lib/notifications/outbox";
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

// ---- Templates tab (admin only) ----

export async function refreshTemplatesAction(): Promise<TemplatesState> {
  await requireSendPermission();
  return loadTemplates();
}

export async function submitTemplateAction(key: string): Promise<TemplatesState> {
  await requireSendPermission();
  const cityId = await getCurrentCityId();
  return submitOurTemplate({ key, cityId });
}

// ---- Choosing who gets a message (admin only) ----
//
// Every list is previewed first, read-only, then queued with the exact customers
// the office left ticked. The server re-plans on queue and only ever NARROWS to the
// chosen ids, so a tampered request can't message someone the rules exclude.

const idList = z.array(z.string().uuid()).max(5000);

export type RecipientRow = { id: string; code: string; name: string; detail: string };

export type PickerState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ready" | "queued"; message: string; rows: RecipientRow[]; skipped: SkippedCustomer[]; totalOutstanding?: string };

const money = (value: string | number) =>
  `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function queuedMessage(result: { queued: number; alreadyQueued: number; skipped: SkippedCustomer[] }, noun: string): string {
  const parts = [`Queued ${result.queued} ${noun}(s).`];
  if (result.alreadyQueued > 0) parts.push(`${result.alreadyQueued} were already queued.`);
  if (result.skipped.length > 0) parts.push(`${result.skipped.length} skipped.`);
  return parts.join(" ");
}

export async function previewRemindersAction(): Promise<PickerState> {
  try {
    await requireSendPermission();
    const plan = await planPaymentReminders(await getCurrentCityId());
    return {
      status: "ready",
      message: plan.candidates.length > 0 ? `${plan.candidates.length} customer(s) are eligible for a reminder.` : "Nobody to remind right now.",
      rows: plan.candidates.map((candidate) => ({
        id: candidate.customerId,
        code: candidate.customerCode,
        name: candidate.customerName,
        detail: money(candidate.outstanding),
      })),
      skipped: plan.skipped,
      totalOutstanding: plan.totalOutstanding.toFixed(2),
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Unable to prepare reminders." };
  }
}

export async function queueRemindersAction(customerIds: string[]): Promise<PickerState> {
  try {
    await requireSendPermission();
    const ids = idList.safeParse(customerIds);
    if (!ids.success) return { status: "error", message: "Invalid selection." };
    if (ids.data.length === 0) return { status: "error", message: "Select at least one customer." };

    const result = await enqueuePaymentReminders({ cityId: await getCurrentCityId(), customerIds: ids.data });
    revalidatePath("/whatsapp");
    return { status: "queued", message: queuedMessage(result, "reminder"), rows: [], skipped: result.skipped };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Unable to queue reminders." };
  }
}

export async function previewBillsAction(billingMonth: string): Promise<PickerState> {
  const parsed = queueBillsSchema.safeParse({ billingMonth });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Select a valid month." };

  try {
    await requireSendPermission();
    const plan = await planMonthlyBills({ cityId: await getCurrentCityId(), billingMonth: monthInputToDate(parsed.data.billingMonth) });
    return {
      status: "ready",
      message: plan.candidates.length > 0 ? `${plan.candidates.length} customer(s) are eligible for a bill message.` : "No eligible bills for that month.",
      rows: plan.candidates.map((candidate) => ({
        id: candidate.customerId,
        code: candidate.customerCode,
        name: candidate.customerName,
        detail: money(candidate.amountDue),
      })),
      skipped: plan.skipped,
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Unable to prepare bill messages." };
  }
}

export async function queueBillsAction(billingMonth: string, customerIds: string[]): Promise<PickerState> {
  const parsed = queueBillsSchema.safeParse({ billingMonth });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Select a valid month." };

  try {
    await requireSendPermission();
    const ids = idList.safeParse(customerIds);
    if (!ids.success) return { status: "error", message: "Invalid selection." };
    if (ids.data.length === 0) return { status: "error", message: "Select at least one customer." };

    const result = await enqueueMonthlyBills({
      cityId: await getCurrentCityId(),
      billingMonth: monthInputToDate(parsed.data.billingMonth),
      customerIds: ids.data,
    });
    revalidatePath("/whatsapp");
    return { status: "queued", message: queuedMessage(result, "bill message"), rows: [], skipped: result.skipped };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Unable to queue bill messages." };
  }
}

// Takes specific people off the queue before they are sent.
export async function removeFromQueueAction(ids: string[]): Promise<WhatsAppActionState> {
  try {
    await requireSendPermission();
    const parsed = idList.safeParse(ids);
    if (!parsed.success || parsed.data.length === 0) return { status: "error", message: "Select at least one message." };

    const count = await cancelMessages({ cityId: await getCurrentCityId(), ids: parsed.data });
    revalidatePath("/whatsapp");
    return {
      status: "success",
      message: count > 0 ? `Removed ${count} message(s) from the queue.` : "Nothing removed — those messages had already been picked up for sending.",
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Unable to remove messages." };
  }
}
