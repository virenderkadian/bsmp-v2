import { loadConfig } from "./config.js";
import { checkSession, sendText } from "./openwa.js";
import {
  isWithinSendingWindow,
  msUntilWindowOpens,
  nextDelayMs,
  remainingToday,
  shouldTripBreaker,
} from "./pacing.js";

// The office-PC sender.
//
// Claims a few messages from the web app, sends them slowly through OpenWA,
// reports what happened, and repeats. It holds no state of its own: the queue,
// the daily count, and every message's fate live in the database, so switching
// this machine off mid-run loses nothing and restarting resumes where it left
// off. That property is the whole reason for the outbox.

const config = loadConfig();

let consecutiveFailures = 0;
let stopping = false;

function log(message, extra) {
  const stamp = new Date().toISOString();
  console.log(extra ? `[${stamp}] ${message} ${JSON.stringify(extra)}` : `[${stamp}] ${message}`);
}

const sleep = (ms) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Do not hold the process open purely to finish a sleep — a Ctrl+C or a
    // service stop should take effect promptly.
    timer.unref?.();
  });

async function callApp(path, body) {
  const response = await fetch(`${config.app.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.app.secret}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.app.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`App API ${path} returned HTTP ${response.status}`);
  }

  return response.json();
}

async function claim() {
  return callApp("/api/notifications/claim", { limit: config.pacing.batchSize });
}

async function report(outcomes) {
  if (outcomes.length === 0) return;
  await callApp("/api/notifications/report", { outcomes });
}

/**
 * Returns claimed messages to the queue without consuming an attempt, for rows
 * we decided not to send rather than tried and failed.
 */
async function releaseAll(messages, reason) {
  await report(
    messages.map((message) => ({ id: message.id, ok: false, error: reason, released: true })),
  );
}

/**
 * Sends one batch, pacing between messages and reporting the whole batch at the
 * end. Reporting per-batch rather than per-message keeps API chatter low; the
 * cost is that a crash mid-batch leaves those rows claimed until their lease
 * expires, which is exactly what the lease is for.
 */
async function sendBatch(messages) {
  const outcomes = [];
  let gatewayDown = false;

  for (const [index, message] of messages.entries()) {
    if (stopping || gatewayDown) {
      // Hand back everything we never got to, so it returns to the queue with
      // its attempt refunded rather than ageing out in SENDING.
      outcomes.push(
        ...messages.slice(index).map((pending) => ({
          id: pending.id,
          ok: false,
          error: "Not attempted — run stopped",
          released: true,
        })),
      );
      break;
    }

    try {
      const { providerRef } = await sendText(config.openwa, message);
      outcomes.push({ id: message.id, ok: true, ...(providerRef ? { providerRef } : {}) });
      consecutiveFailures = 0;
      log("sent", { id: message.id, to: message.chatId });
    } catch (error) {
      const description = error instanceof Error ? error.message : "Unknown send error";

      // Never reached OpenWA: WhatsApp never saw this message and has said
      // nothing about it. It is not a failed send and must not move the
      // breaker — otherwise a stopped Windows service halts the run under a
      // message claiming the number looks restricted.
      if (error?.transport === true) {
        outcomes.push({ id: message.id, ok: false, error: description, released: true });
        log("gateway unreachable — pausing this batch", { error: description });
        gatewayDown = true;
        continue;
      }

      const permanent = error?.permanent === true;
      outcomes.push({ id: message.id, ok: false, error: description, permanent });

      // A permanent rejection ("not on WhatsApp") is a fact about that one
      // number, not about the account, so it does not count either.
      if (!permanent) {
        consecutiveFailures += 1;
      }

      log("send failed", { id: message.id, permanent, error: description });

      if (shouldTripBreaker({ consecutiveFailures, threshold: config.pacing.breakerThreshold })) {
        log(
          `STOPPING: ${consecutiveFailures} sends failed in a row. This is what a restricted number looks like — check WhatsApp on the paired phone before restarting.`,
        );
        stopping = true;
      }
    }

    if (!stopping && !gatewayDown) {
      await sleep(nextDelayMs(config.pacing));
    }
  }

  await report(outcomes);
  return { sent: outcomes.filter((outcome) => outcome.ok).length, gatewayDown };
}

async function main() {
  log("agent starting", {
    app: config.app.baseUrl,
    openwa: config.openwa.baseUrl,
    session: config.openwa.sessionId,
    gap: `${config.pacing.minSeconds}-${config.pacing.maxSeconds}s`,
    window: `${config.pacing.startHour}:00-${config.pacing.endHour}:00`,
    dailyCap: config.pacing.dailyCap,
  });

  while (!stopping) {
    const now = new Date();

    // Sleeping hours first: there is no point asking OpenWA how it is doing
    // every two minutes all night when nothing may be sent regardless.
    if (!isWithinSendingWindow(now, config.pacing)) {
      const wait = msUntilWindowOpens(now, config.pacing);
      log(`outside sending hours — sleeping ${Math.round(wait / 60000)} min`);
      await sleep(Math.min(wait, 30 * 60_000));
      continue;
    }

    // Checked before every batch, not only at startup. A two-day run outlives
    // any single check: phones run out of battery and wifi drops, and the
    // failure mode of not noticing is 25 failed sends and a tripped breaker.
    const session = await checkSession(config.openwa);

    if (session.state === "missing") {
      // Nobody has scanned the QR. No amount of waiting fixes this.
      log(`STOPPING: no WhatsApp session named "${config.openwa.sessionId}". Pair it in the OpenWA dashboard first.`);
      process.exitCode = 1;
      return;
    }

    if (session.state !== "connected") {
      // Unreachable or dropped — both are usually temporary (a service still
      // starting, a phone off wifi), so wait rather than exit. Exiting here
      // would restart-loop under a Windows service manager.
      log(`WhatsApp not ready (${session.state}: ${session.detail}) — retrying in 2 min`);
      await sleep(2 * 60_000);
      continue;
    }

    let claimed;
    try {
      claimed = await claim();
    } catch (error) {
      // Reaching our own API failing is a network problem, not a WhatsApp one.
      // Wait and try again rather than counting it toward the breaker.
      log("could not reach the app — retrying in 60s", {
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(60_000);
      continue;
    }

    const allowedToday = remainingToday({
      dailyCap: config.pacing.dailyCap,
      warmupCap: config.pacing.warmupCap,
      sentToday: claimed.sentToday ?? 0,
    });

    if (claimed.messages.length === 0) {
      log(`queue empty — waiting`, { remaining: claimed.remaining });
      await sleep(60_000);
      continue;
    }

    if (allowedToday <= 0) {
      log(`daily cap reached (${claimed.sentToday} sent today) — resuming tomorrow`);
      // Hand the rows straight back rather than letting them sit in SENDING
      // until the lease expires. They were never attempted, so their attempt
      // counter is refunded too.
      await releaseAll(claimed.messages, "Daily cap reached");
      await sleep(30 * 60_000);
      continue;
    }

    // Anything beyond today's remaining allowance goes back immediately, for
    // the same reason.
    const batch = claimed.messages.slice(0, allowedToday);
    const overflow = claimed.messages.slice(allowedToday);
    if (overflow.length > 0) {
      await releaseAll(overflow, "Beyond today's cap");
    }

    log(`sending ${batch.length} message(s)`, {
      remaining: claimed.remaining,
      sentToday: claimed.sentToday,
    });

    const { sent, gatewayDown } = await sendBatch(batch);
    log(`batch finished`, { sent, of: batch.length });

    if (gatewayDown && !stopping) {
      log("waiting 2 min for the gateway to come back");
      await sleep(2 * 60_000);
    }
  }

  log("agent stopped");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    log(`${signal} received — finishing the current message, then stopping`);
    stopping = true;
  });
}

main().catch((error) => {
  log("fatal", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
