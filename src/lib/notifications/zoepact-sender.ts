import "server-only";
import { signBillLink } from "@/lib/bill-link";
import { isNotificationsEnabled } from "@/lib/notifications/config";
import { claimForZoepact, reclaimExpired, reportOutcomes, type ClaimedRow, type DispatchOutcome } from "@/lib/notifications/dispatch";
import {
  getWalletBalance, sendTemplate, type SendTemplateInput, type ZoepactResult,
} from "@/lib/notifications/zoepact";
import {
  isZoepactTemplateKey, monthlyBillLinkValues, paymentReminderValues, ZOEPACT_TEMPLATES, ZOEPACT_TEMPLATE_KEYS,
  zoepactVariableSchemas,
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

// Customers are messaged in the daytime, India time: 09:00 to 20:00. A bill
// arriving at 2am is the kind of contact that gets a number reported.
const SEND_FROM_HOUR_IST = 9;
const SEND_UNTIL_HOUR_IST = 20;

export function isInSendWindow(now: Date): boolean {
  const hourIst = new Date(now.getTime() + 5.5 * 60 * 60 * 1000).getUTCHours();
  return hourIst >= SEND_FROM_HOUR_IST && hourIst < SEND_UNTIL_HOUR_IST;
}

type Built = { ok: true; input: Omit<SendTemplateInput, "phone"> } | { ok: false; error: string };

// Turns a stored (template key, variables) pair into the exact API call. Pure
// apart from the injected signer, so it is tested without a network or secret.
export function buildZoepactSend(template: string, variables: unknown, sign: (billId: string) => string): Built {
  if (!isZoepactTemplateKey(template)) {
    return { ok: false, error: `Not a Zoepact template: ${template}` };
  }
  const definition = ZOEPACT_TEMPLATES[template];
  const parsed = zoepactVariableSchemas[template].safeParse(variables);
  if (!parsed.success) {
    return { ok: false, error: `Invalid variables for ${template}: ${parsed.error.issues[0]?.message ?? "unknown"}` };
  }

  if (template === "payment_reminder_hi_en_v1") {
    const v = parsed.data as { month: number; outstanding: number | string };
    return {
      ok: true,
      input: { templateName: definition.zoepactName, language: definition.language, variables: paymentReminderValues({ month: v.month, outstanding: v.outstanding }) },
    };
  }

  const v = parsed.data as { customerName: string; month: number; amountDue: number | string; billId: string };
  const { variables: values, buttonToken } = monthlyBillLinkValues({
    customerName: v.customerName, month: v.month, amountDue: v.amountDue, token: sign(v.billId),
  });
  return {
    ok: true,
    input: {
      templateName: definition.zoepactName,
      language: definition.language,
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

  const rows: ClaimedRow[] = await claimForZoepact(BATCH_SIZE);
  const outcomes: DispatchOutcome[] = [];
  let configFailure: string | null = null;

  for (const row of rows) {
    if (configFailure) {
      // Our key/account is broken: hand the rest back untouched, attempt refunded.
      outcomes.push({ id: row.id, ok: false, error: configFailure, released: true });
      continue;
    }

    const built = buildZoepactSend(row.template, row.variables, (billId) => signBillLink(billId));
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
