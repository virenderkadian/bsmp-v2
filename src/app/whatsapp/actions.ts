"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentCityId } from "@/lib/current-city";
import { getCurrentUser } from "@/lib/current-user";
import { bulkOptIn, bulkOptInUpdates, planUpdatesOptIn, setCustomerConsent, setUpdatesConsent, type UpdatesKind } from "@/lib/notifications/consent";
import { enqueueDeliveryUpdates, planDeliveryUpdates, readableDay } from "@/lib/notifications/delivery-updates";
import { enqueueNotice, isNoticeTemplate, planNoticeAudience } from "@/lib/notifications/notices";
import { enqueuePaymentUpdates, modeLabel, planPaymentUpdates } from "@/lib/notifications/payment-updates";
import { enqueuePaymentReminders, planPaymentReminders } from "@/lib/notifications/reminders";
import { loadTemplates, saveWording, submitVersion, activateTemplateVersion, type TemplatesState } from "@/lib/notifications/template-admin";
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

// Sends one version (null = the built-in wording) to Meta for review.
export async function submitTemplateAction(key: string, versionId: string | null): Promise<TemplatesState> {
  await requireSendPermission();
  return submitVersion({ key, versionId, cityId: await getCurrentCityId() });
}

// Saves reworded text as the next version. It is not used until Meta approves it and it is switched on.
export async function saveTemplateWordingAction(key: string, body: string, footer: string, buttonText: string): Promise<TemplatesState> {
  await requireSendPermission();
  const user = await getCurrentUser();
  return saveWording({
    key,
    wording: { body, footer, buttonText },
    cityId: await getCurrentCityId(),
    actor: user ? { id: user.id, name: user.fullName } : null,
  });
}

// Switches messages to an approved version (null = the built-in wording).
export async function switchTemplateVersionAction(key: string, versionId: string | null): Promise<TemplatesState> {
  await requireSendPermission();
  const state = await activateTemplateVersion({ key, versionId, cityId: await getCurrentCityId() });
  // The previews on the other tabs show the wording in use.
  revalidatePath("/whatsapp");
  return state;
}

// ---- Choosing who gets a message (admin only) ----
//
// Every list is previewed first, read-only, then queued with the exact customers
// the office left ticked. The server re-plans on queue and only ever NARROWS to the
// chosen ids, so a tampered request can't message someone the rules exclude.

const idList = z.array(z.string().uuid()).max(5000);

export type RecipientRow = {
  id: string;
  code: string;
  name: string;
  // What is shown on the right (formatted money) and the same figure as a number, for filtering.
  detail: string;
  // Absent for notices, which have no per-customer amount (so no amount filter).
  amount?: number;
  routeId: string;
  routeLabel: string;
  vehicleId: string;
  vehicleLabel: string;
};

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
        amount: candidate.outstanding,
        routeId: candidate.routeId,
        routeLabel: candidate.routeLabel,
        vehicleId: candidate.vehicleId,
        vehicleLabel: candidate.vehicleLabel,
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
        amount: Number(candidate.amountDue),
        routeId: candidate.routeId,
        routeLabel: candidate.routeLabel,
        vehicleId: candidate.vehicleId,
        vehicleLabel: candidate.vehicleLabel,
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

// ---- Notices: rate change and delivery notice (admin only) ----

export async function previewNoticeAudienceAction(): Promise<PickerState> {
  try {
    await requireSendPermission();
    const audience = await planNoticeAudience(await getCurrentCityId());
    const left = [
      audience.noConsent > 0 ? `${audience.noConsent} without WhatsApp consent` : "",
      audience.noNumber > 0 ? `${audience.noNumber} without a usable number` : "",
    ].filter(Boolean);
    return {
      status: "ready",
      message: `${audience.candidates.length} customer(s) can receive a notice${left.length > 0 ? `; left out: ${left.join(", ")}` : ""}.`,
      rows: audience.candidates.map((candidate) => ({
        id: candidate.customerId,
        code: candidate.customerCode,
        name: candidate.customerName,
        detail: "",
        routeId: candidate.routeId,
        routeLabel: candidate.routeLabel,
        vehicleId: candidate.vehicleId,
        vehicleLabel: candidate.vehicleLabel,
      })),
      skipped: [],
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Unable to prepare the notice." };
  }
}

export async function queueNoticeAction(template: string, variables: unknown, customerIds: string[]): Promise<PickerState> {
  try {
    await requireSendPermission();
    if (!isNoticeTemplate(template)) return { status: "error", message: "Unknown notice type." };
    const ids = idList.safeParse(customerIds);
    if (!ids.success) return { status: "error", message: "Invalid selection." };
    if (ids.data.length === 0) return { status: "error", message: "Select at least one customer." };

    const result = await enqueueNotice({ cityId: await getCurrentCityId(), template, variables, customerIds: ids.data });
    revalidatePath("/whatsapp");
    const parts = [`Queued ${result.queued} notice(s).`];
    if (result.alreadyQueued > 0) parts.push(`${result.alreadyQueued} had already been sent this notice.`);
    return { status: "queued", message: parts.join(" "), rows: [], skipped: [] };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Unable to queue the notice." };
  }
}

// ---- Delivery completed (admin only) ----

export type DeliveryPickerState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ready" | "queued"; message: string; rows: RecipientRow[]; sample: { name: string; date: string; itemsText: string; amount: string } | null };

export async function previewDeliveryUpdatesAction(day: string): Promise<DeliveryPickerState> {
  try {
    await requireSendPermission();
    const audience = await planDeliveryUpdates(await getCurrentCityId(), day);
    const left = [
      audience.noConsent > 0 ? `${audience.noConsent} without WhatsApp consent` : "",
      audience.noDeliveryOptIn > 0 ? `${audience.noDeliveryOptIn} who haven't opted in to delivery updates (set that on the Consent tab)` : "",
      audience.noNumber > 0 ? `${audience.noNumber} without a usable number` : "",
      audience.tooLong > 0 ? `${audience.tooLong} with too many products for one message` : "",
    ].filter(Boolean);
    const first = audience.candidates[0];
    return {
      status: "ready",
      message:
        audience.delivered === 0
          ? "No deliveries are recorded for that date."
          : `${audience.delivered} customer(s) were delivered; ${audience.candidates.length} can get a message${left.length > 0 ? `. Left out: ${left.join(", ")}` : ""}.`,
      rows: audience.candidates.map((candidate) => ({
        id: candidate.customerId,
        code: candidate.customerCode,
        name: candidate.customerName,
        detail: money(candidate.amount),
        amount: candidate.amount,
        routeId: candidate.routeId,
        routeLabel: candidate.routeLabel,
        vehicleId: candidate.vehicleId,
        vehicleLabel: candidate.vehicleLabel,
      })),
      sample: first
        ? { name: first.customerName, date: readableDay(day), itemsText: first.itemsText, amount: first.amount.toFixed(2) }
        : null,
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Unable to prepare delivery updates." };
  }
}

export async function queueDeliveryUpdatesAction(day: string, customerIds: string[]): Promise<DeliveryPickerState> {
  try {
    await requireSendPermission();
    const ids = idList.safeParse(customerIds);
    if (!ids.success) return { status: "error", message: "Invalid selection." };
    if (ids.data.length === 0) return { status: "error", message: "Select at least one customer." };

    const result = await enqueueDeliveryUpdates({ cityId: await getCurrentCityId(), day, customerIds: ids.data });
    revalidatePath("/whatsapp");
    const parts = [`Queued ${result.queued} delivery update(s).`];
    if (result.alreadyQueued > 0) parts.push(`${result.alreadyQueued} had already been queued for that date.`);
    return { status: "queued", message: parts.join(" "), rows: [], sample: null };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Unable to queue delivery updates." };
  }
}

// ---- Extra opt-ins: delivery updates and payment updates (admin only) ----

const KIND_LABEL: Record<UpdatesKind, string> = { delivery: "delivery updates", payment: "payment updates" };

function asKind(value: string): UpdatesKind | null {
  return value === "delivery" || value === "payment" ? value : null;
}

export async function toggleUpdatesConsent(
  _prevState: WhatsAppActionState = idleState,
  formData: FormData,
): Promise<WhatsAppActionState> {
  void _prevState;

  const customerId = getValue(formData, "customerId");
  const kind = asKind(getValue(formData, "kind"));
  const optIn = getValue(formData, "optIn") === "true";
  if (!customerId || !kind) return { status: "error", message: "Missing customer." };

  try {
    await requireSendPermission();
    await setUpdatesConsent({ cityId: await getCurrentCityId(), customerId, kind, optIn });
    revalidatePath("/whatsapp");
    return { status: "success", message: `${optIn ? "Opted in to" : "Opted out of"} ${KIND_LABEL[kind]}.` };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Unable to update consent." };
  }
}

// Who COULD be opted in to this kind, so the office can choose by route or vehicle.
export async function previewUpdatesOptInAction(kindValue: string): Promise<PickerState> {
  const kind = asKind(kindValue);
  if (!kind) return { status: "error", message: "Unknown kind." };
  try {
    await requireSendPermission();
    const plan = await planUpdatesOptIn(await getCurrentCityId(), kind);
    const left = [
      plan.alreadyOptedIn > 0 ? `${plan.alreadyOptedIn} already opted in` : "",
      plan.noWhatsAppConsent > 0 ? `${plan.noWhatsAppConsent} need WhatsApp consent first` : "",
      plan.noNumber > 0 ? `${plan.noNumber} have no usable number` : "",
    ].filter(Boolean);
    return {
      status: "ready",
      message: `${plan.candidates.length} customer(s) can be opted in${left.length > 0 ? `. Not listed: ${left.join(", ")}` : ""}.`,
      rows: plan.candidates.map((candidate) => ({
        id: candidate.customerId,
        code: candidate.customerCode,
        name: candidate.customerName,
        detail: candidate.mobile,
        routeId: candidate.routeId,
        routeLabel: candidate.routeLabel,
        vehicleId: candidate.vehicleId,
        vehicleLabel: candidate.vehicleLabel,
      })),
      skipped: [],
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Unable to prepare the list." };
  }
}

// Records the opt-in for exactly the customers chosen. `confirmed` is the office's statement
// that these customers agreed: without it nothing is recorded.
export async function bulkOptInUpdatesAction(kindValue: string, customerIds: string[], confirmed: boolean): Promise<WhatsAppActionState> {
  const kind = asKind(kindValue);
  if (!kind) return { status: "error", message: "Unknown kind." };
  try {
    await requireSendPermission();
    if (!confirmed) return { status: "error", message: `Confirm that these customers agreed to get ${KIND_LABEL[kind]}.` };
    const ids = idList.safeParse(customerIds);
    if (!ids.success || ids.data.length === 0) return { status: "error", message: "Select at least one customer." };

    const count = await bulkOptInUpdates({ cityId: await getCurrentCityId(), kind, customerIds: ids.data });
    revalidatePath("/whatsapp");
    return {
      status: "success",
      message: count > 0 ? `Opted ${count} customer(s) in to ${KIND_LABEL[kind]}.` : "Nobody was opted in: those customers weren't eligible.",
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Unable to record the opt-in." };
  }
}

// ---- Payment received (admin only) ----

export type PaymentPickerState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ready" | "queued"; message: string; rows: RecipientRow[]; sample: { name: string; date: string; amount: string; mode: string } | null };

export async function previewPaymentUpdatesAction(from: string, to: string): Promise<PaymentPickerState> {
  try {
    await requireSendPermission();
    const audience = await planPaymentUpdates(await getCurrentCityId(), from, to);
    const left = [
      audience.noConsent > 0 ? `${audience.noConsent} without WhatsApp consent` : "",
      audience.noPaymentOptIn > 0 ? `${audience.noPaymentOptIn} whose customers haven't opted in to payment updates (set that on the Consent tab)` : "",
      audience.noNumber > 0 ? `${audience.noNumber} without a usable number` : "",
    ].filter(Boolean);
    const first = audience.candidates[0];
    return {
      status: "ready",
      message:
        audience.verified === 0
          ? "No verified payments in that date range."
          : `${audience.verified} verified payment(s); ${audience.candidates.length} can get a receipt${left.length > 0 ? `. Left out: ${left.join(", ")}` : ""}${audience.truncated ? ". Only the most recent are shown; narrow the dates" : ""}.`,
      // One row per PAYMENT (a customer can have several): the id is the payment's.
      rows: audience.candidates.map((candidate) => ({
        id: candidate.paymentId,
        code: candidate.customerCode,
        name: `${candidate.customerName} · ${modeLabel(candidate.mode)} · ${readableDay(candidate.day)}`,
        detail: money(candidate.amount),
        amount: candidate.amount,
        routeId: candidate.routeId,
        routeLabel: candidate.routeLabel,
        vehicleId: candidate.vehicleId,
        vehicleLabel: candidate.vehicleLabel,
      })),
      sample: first ? { name: first.customerName, date: readableDay(first.day), amount: first.amount.toFixed(2), mode: first.mode } : null,
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Unable to prepare payment receipts." };
  }
}

export async function queuePaymentUpdatesAction(from: string, to: string, paymentIds: string[]): Promise<PaymentPickerState> {
  try {
    await requireSendPermission();
    const ids = idList.safeParse(paymentIds);
    if (!ids.success) return { status: "error", message: "Invalid selection." };
    if (ids.data.length === 0) return { status: "error", message: "Select at least one payment." };

    const result = await enqueuePaymentUpdates({ cityId: await getCurrentCityId(), from, to, paymentIds: ids.data });
    revalidatePath("/whatsapp");
    const parts = [`Queued ${result.queued} payment receipt(s).`];
    if (result.alreadyQueued > 0) parts.push(`${result.alreadyQueued} had already been queued.`);
    return { status: "queued", message: parts.join(" "), rows: [], sample: null };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Unable to queue payment receipts." };
  }
}
