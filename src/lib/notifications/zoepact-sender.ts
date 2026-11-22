import "server-only";
import { signBillLink } from "@/lib/bill-link";
import { isNotificationsEnabled } from "@/lib/notifications/config";
import { loadActiveTemplates } from "@/lib/notifications/template-wording";
import { claimForZoepact, reclaimExpired, reportOutcomes, type ClaimedRow, type DispatchOutcome } from "@/lib/notifications/dispatch";
import {
  getWalletBalance, sendTemplate, type SendTemplateInput, type ZoepactResult,
} from "@/lib/notifications/zoepact";
import {
  deliveryCompletedValues, deliveryNoticeValues, isZoepactTemplateKey, monthlyBillLinkValues, paymentReceivedValues, paymentReminderValues, rateChangeValues,
  ZOEPACT_TEMPLATES, ZOEPACT_TEMPLATE_KEYS, zoepactVariableSchemas,
} from "@/lib/notifications/zoepact-templates";
import { prisma } from "@/lib/prisma";

// Drains the outbox through Zoepact. Run by a Vercel Cron every minute (see
// src/app/api/cron/notifications/route.ts) in small batches, so a two-thousand
// customer run is spread over the day, and an idle minute costs two tiny queries.

const BATCH_SIZE = 20;
// Gap between sends within a batch: Meta isn't the bottleneck, but a burst of 20
// requests in one tick is needless.
const SEND_GAP_MS = 150;
// Below this the wallet is treated as empty and sending pauses — a send with no
// balance fails per message, which would burn every row's retry budget.
const WALLET_MIN = 10;

// Customers are messaged in the daytime, India time. This is OUR choice, not a WhatsApp
// rule: a bill or reminder arriving at 2am is the kind of contact that gets a number
// reported. The hours default to 09:00-20:00 and can be changed without a code change by
// setting NOTIFICATIONS_SEND_FROM_HOUR and NOTIFICATIONS_SEND_UNTIL_HOUR (0-24, IST,
// the "until" hour itself is excluded).
const DEFAULT_FROM_HOUR_IST = 9;
const DEFAULT_UNTIL_HOUR_IST = 20;

function hourFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 24 ? value : fallback;
}

export function isInSendWindow(
  now: Date,
  hours: { from: number; until: number } = {
    from: hourFromEnv("NOTIFICATIONS_SEND_FROM_HOUR", DEFAULT_FROM_HOUR_IST),
    until: hourFromEnv("NOTIFICATIONS_SEND_UNTIL_HOUR", DEFAULT_UNTIL_HOUR_IST),
  },
): boolean {
  const hourIst = new Date(now.getTime() + 5.5 * 60 * 60 * 1000).getUTCHours();
  return hourIst >= hours.from && hourIst < hours.until;
}

export type SenderStatus = {
  keyConfigured: boolean;
  inWindow: boolean;
  fromHour: number;
  untilHour: number;
  wallet: { state: "ok"; balance: number } | { state: "low"; balance: number } | { state: "unreadable"; message: string };
};

// What the office needs to know when messages are "queued but nothing arrives": is the key
// set, are we inside sending hours, is the wallet funded. Read-only.
export async function getSenderStatus(now = new Date()): Promise<SenderStatus> {
  const fromHour = hourFromEnv("NOTIFICATIONS_SEND_FROM_HOUR", DEFAULT_FROM_HOUR_IST);
  const untilHour = hourFromEnv("NOTIFICATIONS_SEND_UNTIL_HOUR", DEFAULT_UNTIL_HOUR_IST);
  const keyConfigured = Boolean(process.env.ZOEPACT_API_KEY);
  let wallet: SenderStatus["wallet"] = { state: "unreadable", message: "No API key set" };
  if (keyConfigured) {
    const result = await getWalletBalance();
    wallet = !result.ok
      ? { state: "unreadable", message: result.message }
      : result.data.balance < WALLET_MIN
        ? { state: "low", balance: result.data.balance }
        : { state: "ok", balance: result.data.balance };
  }
  return { keyConfigured, inWindow: isInSendWindow(now, { from: fromHour, until: untilHour }), fromHour, untilHour, wallet };
}

type Built = { ok: true; input: Omit<SendTemplateInput, "phone"> } | { ok: false; error: string };

// Turns a stored (template key, variables) pair into the exact API call. Pure
// apart from the injected signer, so it is tested without a network or secret.
//
// `inUse` is the template version messages are currently sent with (its name at Meta and
// its language); without it the built-in one is used.
export function buildZoepactSend(
  template: string,
  variables: unknown,
  sign: (billId: string) => string,
  inUse?: { zoepactName: string; language: string },
): Built {
  if (!isZoepactTemplateKey(template)) {
    return { ok: false, error: `Not a Zoepact template: ${template}` };
  }
  const definition = ZOEPACT_TEMPLATES[template];
  const templateName = inUse?.zoepactName ?? definition.zoepactName;
  const language = inUse?.language ?? definition.language;
  const parsed = zoepactVariableSchemas[template].safeParse(variables);
  if (!parsed.success) {
    return { ok: false, error: `Invalid variables for ${template}: ${parsed.error.issues[0]?.message ?? "unknown"}` };
  }

  if (template === "payment_reminder_hi_en_v1") {
    const v = parsed.data as { month: number; outstanding: number | string };
    return {
      ok: true,
      input: { templateName, language, variables: paymentReminderValues({ month: v.month, outstanding: v.outstanding }) },
    };
  }

  if (template === "rate_change_notice_v1") {
    const v = parsed.data as { effectiveDate: string; ratesTextHi: string; ratesTextEn: string };
    return { ok: true, input: { templateName, language, variables: rateChangeValues(v) } };
  }

  if (template === "payment_received_v1") {
    const v = parsed.data as { amount: number | string; date: string; mode: string };
    return { ok: true, input: { templateName, language, variables: paymentReceivedValues(v) } };
  }

  if (template === "delivery_completed_v1") {
    const v = parsed.data as { date: string; itemsText: string; amount: number | string };
    return { ok: true, input: { templateName, language, variables: deliveryCompletedValues(v) } };
  }

  if (template === "delivery_notice_v1") {
    const v = parsed.data as { date: string; messageHi: string; messageEn: string };
    return { ok: true, input: { templateName, language, variables: deliveryNoticeValues(v) } };
  }

  const v = parsed.data as { customerName: string; month: number; amountDue: number | string; billId: string };
  const { variables: values, buttonToken } = monthlyBillLinkValues({
    customerName: v.customerName, month: v.month, amountDue: v.amountDue, token: sign(v.billId),
  });
  return {
    ok: true,
    input: {
      templateName,
      language,
      variables: values,
      buttonVariables: [{ index: 0, sub_type: "url", text: buttonToken }],
    },
  };
}

// What the outbox should do with one send's result — see zoepact.ts for the four
// failure kinds. "ambiguous" is the dangerous one: the API has no idempotency
// key, so the message may already have reached the customer. It is NOT retried;
// it is failed with a plain note so an office user can check before resending.
export function outcomeFor(id: string, result: ZoepactResult<{ messageId?: string }>): DispatchOutcome {
  if (result.ok) {
    return { id, ok: true, providerRef: result.data.messageId };
  }
  switch (result.kind) {
    case "invalid":
      return { id, ok: false, error: result.message, permanent: true };
    case "ambiguous":
      return { id, ok: false, error: `UNCONFIRMED — may have been delivered, check before resending. (${result.message})`, permanent: true };
    case "config":
      return { id, ok: false, error: result.message, released: true };
    case "transient":
      return { id, ok: false, error: result.message };
  }
}

export type BatchResult = {
  status: "disabled" | "outside-window" | "idle" | "paused" | "ran";
  sent: number;
  failed: number;
  retrying: number;
  released: number;
  message?: string;
};

const none = { sent: 0, failed: 0, retrying: 0, released: 0 };

export async function runZoepactBatch(now = new Date()): Promise<BatchResult> {
  if (!isNotificationsEnabled() || !process.env.ZOEPACT_API_KEY) {
    return { status: "disabled", ...none };
  }
  if (!isInSendWindow(now)) {
    return { status: "outside-window", ...none };
  }

  // Give back rows a dead run left claimed, then see if there is anything to do.
  await reclaimExpired();
  const waiting = await prisma.notificationOutbox.count({
    where: {
      status: "PENDING", channel: "WHATSAPP", template: { in: ZOEPACT_TEMPLATE_KEYS },
      notBefore: { lte: now }, attempts: { lt: 3 },
    },
  });
  if (waiting === 0) {
    return { status: "idle", ...none };
  }

  // An unreadable wallet doesn't block sending (the docs don't show its shape);
  // a readable, empty one does, and so does a rejected key.
  const wallet = await getWalletBalance();
  if (!wallet.ok && wallet.kind === "config") {
    return { status: "paused", ...none, message: wallet.message };
  }
  if (wallet.ok && wallet.data.balance < WALLET_MIN) {
    return { status: "paused", ...none, message: `Wallet balance is ₹${wallet.data.balance}; top up to continue.` };
  }

  // Which version of each template is in use: one small query per run.
  const active = await loadActiveTemplates();
  const rows: ClaimedRow[] = await claimForZoepact(BATCH_SIZE);

  // A payment receipt must not go out for a payment that has been cancelled (or put back to
  // pending) since it was queued: check each one just before sending.
  const receiptIds = rows
    .filter((row) => row.template === "payment_received_v1")
    .map((row) => (row.variables as { paymentId?: string } | null)?.paymentId)
    .filter((id): id is string => typeof id === "string");
  const stillVerified = new Set(
    receiptIds.length > 0
      ? (await prisma.payment.findMany({ where: { id: { in: receiptIds }, status: "VERIFIED" }, select: { id: true } })).map((payment) => payment.id)
      : [],
  );
  const outcomes: DispatchOutcome[] = [];
  let configFailure: string | null = null;

  for (const row of rows) {
    if (configFailure) {
      // Our key/account is broken: hand the rest back untouched, attempt refunded.
      outcomes.push({ id: row.id, ok: false, error: configFailure, released: true });
      continue;
    }

    if (row.template === "payment_received_v1") {
      const paymentId = (row.variables as { paymentId?: string } | null)?.paymentId;
      if (paymentId && !stillVerified.has(paymentId)) {
        outcomes.push({ id: row.id, ok: false, error: "The payment is no longer verified, so no receipt was sent.", permanent: true });
        continue;
      }
    }

    const built = buildZoepactSend(row.template, row.variables, (billId) => signBillLink(billId), isZoepactTemplateKey(row.template) ? active[row.template] : undefined);
    if (!built.ok) {
      outcomes.push({ id: row.id, ok: false, error: built.error, permanent: true });
      continue;
    }

    const result = await sendTemplate({ phone: row.recipient, ...built.input });
    const outcome = outcomeFor(row.id, result);
    outcomes.push(outcome);
    if (!outcome.ok && outcome.released) {
      configFailure = outcome.error;
    }
    await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
  }

  await reportOutcomes(outcomes);

  return {
    status: "ran",
    sent: outcomes.filter((outcome) => outcome.ok).length,
    failed: outcomes.filter((outcome) => !outcome.ok && !outcome.released && outcome.permanent).length,
    retrying: outcomes.filter((outcome) => !outcome.ok && !outcome.released && !outcome.permanent).length,
    released: outcomes.filter((outcome) => !outcome.ok && outcome.released).length,
    ...(configFailure ? { message: configFailure } : {}),
  };
}
