import "server-only";
import { Prisma } from "@prisma/client";
import { renderTemplate } from "@/lib/notifications/templates";
import { toWhatsAppChatId } from "@/lib/notifications/phone";
import { prisma } from "@/lib/prisma";

// Agent-facing half of the outbox. The office-PC sender calls exactly two
// operations — claim some work, report what happened — and deliberately knows
// nothing else. Messages are rendered here rather than on the agent, so
// changing wording is a web deploy and never a visit to the office PC.

// How long a claimed row may sit before another agent may take it. Sends take
// seconds; five minutes means a genuinely dead agent is recovered promptly
// while a merely slow one is not raced.
const CLAIM_LEASE_MS = 5 * 60 * 1000;

// Retry budget per row. Deliberately small: at 20-30s pacing, a row that has
// failed three times is burning send capacity that the remaining ~1,900
// customers need more than it does.
const MAX_ATTEMPTS = 3;

// Exponential-ish backoff before a retryable failure becomes claimable again.
const RETRY_BACKOFF_MS = [2 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];

export type ClaimedMessage = {
  id: string;
  chatId: string;
  text: string;
};

type ClaimedRow = {
  id: string;
  recipient: string;
  template: string;
  variables: Prisma.JsonValue;
};

// Returns claimed rows to PENDING when their lease has expired. The expected
// cause is mundane — the office PC was switched off partway through an
// overnight stretch of a two-day run — so this is normal housekeeping, not
// error recovery.
async function reclaimExpired(): Promise<number> {
  const cutoff = new Date(Date.now() - CLAIM_LEASE_MS);

  const result = await prisma.notificationOutbox.updateMany({
    where: { status: "SENDING", claimedAt: { lt: cutoff } },
    data: { status: "PENDING", claimedAt: null },
  });

  return result.count;
}

// Atomically takes up to `limit` ready messages.
//
// One statement, because two agents running by accident must not both send the
// same bill. FOR UPDATE SKIP LOCKED makes them divide the work instead of
// duplicating it. Small batches keep the blast radius of a crash small: only
// rows already claimed are at risk, not the whole queue.
export async function claimPending(limit = 25): Promise<ClaimedMessage[]> {
  await reclaimExpired();

  // attempts is incremented at claim time rather than on failure. A row whose
  // agent dies mid-send still consumes an attempt, so a message that reliably
  // crashes the sender cannot be reclaimed and re-tried forever.
  const rows = await prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
    UPDATE "NotificationOutbox"
    SET status = 'SENDING'::"NotificationStatus",
        "claimedAt" = NOW(),
        attempts = attempts + 1,
        "updatedAt" = NOW()
    WHERE id IN (
      SELECT id
      FROM "NotificationOutbox"
      WHERE status = 'PENDING'::"NotificationStatus"
        AND channel = 'WHATSAPP'::"NotificationChannel"
        AND "notBefore" <= NOW()
        AND attempts < ${MAX_ATTEMPTS}
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, recipient, template, variables
  `);

  const claimed: ClaimedMessage[] = [];

  for (const row of rows) {
    try {
      claimed.push({
        id: row.id,
        chatId: toWhatsAppChatId(row.recipient),
        text: renderTemplate(row.template, row.variables),
      });
    } catch (error) {
      // A row that cannot be rendered will never render — an unknown template,
      // or variables queued by an older version of the app. Failing it here
      // keeps it out of the agent's hands entirely rather than letting it fail
      // repeatedly at send time.
      await prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          lastError: error instanceof Error ? error.message : "Could not render message",
        },
      });
    }
  }

  return claimed;
}

export type DispatchOutcome =
  | { id: string; ok: true; providerRef?: string }
  // `released` means the agent never actually attempted the send — it could not
  // reach the WhatsApp gateway at all. Distinct from a failure because the
  // attempt counter must be given back: an hour of OpenWA being stopped would
  // otherwise burn through every row's retry budget and mark two thousand
  // perfectly good messages FAILED without one of them ever being tried.
  | { id: string; ok: false; error: string; permanent?: boolean; released?: boolean };

// Records what the provider did with each claimed message.
//
// Three outcomes, not two. "Not a WhatsApp number" is permanent and must not be
// retried; a timeout mid-send is worth another go; and never having reached the
// gateway is not a failure of the message at all.
export async function reportOutcomes(outcomes: DispatchOutcome[]): Promise<{ recorded: number }> {
  let recorded = 0;

  for (const outcome of outcomes) {
    if (!outcome.ok && outcome.released) {
      // Straight back to the queue, attempt refunded, no backoff — the agent
      // paces its own retry when the gateway is down.
      await prisma.notificationOutbox.update({
        where: { id: outcome.id },
        data: {
          status: "PENDING",
          claimedAt: null,
          lastError: outcome.error,
          attempts: { decrement: 1 },
        },
      });
      recorded += 1;
      continue;
    }

    if (outcome.ok) {
      await prisma.notificationOutbox.update({
        where: { id: outcome.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          providerRef: outcome.providerRef ?? null,
          lastError: null,
        },
      });
      recorded += 1;
      continue;
    }

    const current = await prisma.notificationOutbox.findUnique({
      where: { id: outcome.id },
      select: { attempts: true },
    });

    if (!current) continue;

    const exhausted = outcome.permanent === true || current.attempts >= MAX_ATTEMPTS;
    const backoff = RETRY_BACKOFF_MS[Math.min(current.attempts - 1, RETRY_BACKOFF_MS.length - 1)] ?? 0;

    await prisma.notificationOutbox.update({
      where: { id: outcome.id },
      data: exhausted
        ? { status: "FAILED", lastError: outcome.error, claimedAt: null }
        : {
            status: "PENDING",
            lastError: outcome.error,
            claimedAt: null,
            notBefore: new Date(Date.now() + backoff),
          },
    });
    recorded += 1;
  }

  return { recorded };
}

// Lets the agent decide whether there is anything worth staying awake for, and
// gives the web UI a live "still running" signal without scanning the queue.
//
// `sentToday` is counted here rather than tallied by the agent so the daily cap
// survives the agent restarting — which it will, since it runs on an office PC
// that gets switched off. An in-memory counter would reset to zero every
// morning and quietly allow twice the intended volume.
export async function getQueueDepth(): Promise<{
  pending: number;
  sending: number;
  sentToday: number;
}> {
  // Start of the current day in IST, expressed as an instant. The business is
  // in India; a UTC day boundary would roll the cap over at 5:30am local.
  const startOfDayIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  startOfDayIst.setUTCHours(0, 0, 0, 0);
  const since = new Date(startOfDayIst.getTime() - 5.5 * 60 * 60 * 1000);

  const [pending, sending, sentToday] = await Promise.all([
    prisma.notificationOutbox.count({
      where: { status: "PENDING", channel: "WHATSAPP", attempts: { lt: MAX_ATTEMPTS } },
    }),
    prisma.notificationOutbox.count({ where: { status: "SENDING", channel: "WHATSAPP" } }),
    prisma.notificationOutbox.count({
      where: { status: "SENT", channel: "WHATSAPP", sentAt: { gte: since } },
    }),
  ]);

  return { pending, sending, sentToday };
}
