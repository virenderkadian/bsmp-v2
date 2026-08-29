// The only file in this project that knows OpenWA exists.
//
// Everything above it deals in "send this text to this chat id". Moving to
// Meta's Cloud API — or any other provider — means writing a second file with
// the same two exports and pointing config.js at it. Nothing else changes:
// not the outbox, not the pacing, not the web UI.

/**
 * Errors WhatsApp will give the same answer to no matter how often we ask.
 * Marking these permanent stops the retry budget being spent on numbers that
 * will never work — which matters when ~1,900 other customers are queued
 * behind them.
 */
const PERMANENT_PATTERNS = [
  /not.*(registered|on whatsapp|a valid)/i,
  /invalid.*(chat|number|recipient)/i,
  /no account/i,
];

function isPermanent(message) {
  return PERMANENT_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Marks an error as a transport failure — we never reached OpenWA, so WhatsApp
 * never saw the message and said nothing about it.
 *
 * This distinction is the whole basis of the circuit breaker. "OpenWA is
 * stopped" and "WhatsApp rejected your message" both surface as a thrown error,
 * but only the second says anything about the account's standing. Conflating
 * them means a stopped Windows service halts a run with a message claiming the
 * number looks restricted.
 */
function transportError(cause) {
  const error = new Error(
    `Cannot reach OpenWA at ${cause.baseUrl} — is it running? (${cause.message})`,
  );
  error.transport = true;
  return error;
}

async function request(config, path, body) {
  let response;

  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": config.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (cause) {
    // Connection refused, DNS failure, timeout — the request never landed.
    throw transportError({ baseUrl: config.baseUrl, message: cause?.message ?? String(cause) });
  }

  // A response — even an error response — means OpenWA answered, so anything
  // from here on is a real verdict about the message.
  const text = await response.text();

  if (!response.ok) {
    // OpenWA returns JSON errors, but a crashed or misconfigured instance can
    // return HTML. Preferring the raw text keeps the real cause visible in
    // lastError instead of "undefined".
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.message ?? parsed.error ?? text;
    } catch {
      // Not JSON — the raw body is the best description available.
    }

    const error = new Error(`OpenWA ${response.status}: ${String(detail).slice(0, 300)}`);
    error.permanent = response.status === 400 || response.status === 404 ? isPermanent(String(detail)) : false;
    throw error;
  }

  return text ? JSON.parse(text) : {};
}

/**
 * Reports whether the session can send right now.
 *
 * Three outcomes rather than a boolean, because they call for different
 * responses and conflating them is how a five-minute wifi drop becomes an
 * agent that exited overnight:
 *
 *   "missing"      — no such session. Nobody has scanned the QR. Fatal; a
 *                    human has to do something.
 *   "unreachable"  — OpenWA itself is not answering. Wait; it may be starting.
 *   "disconnected" — paired, but the link is down (phone off, no wifi).
 *                    Temporary by nature, so wait rather than give up.
 *   "connected"    — go.
 */
export async function checkSession(config) {
  let response;

  try {
    response = await fetch(`${config.baseUrl}/api/sessions/${config.sessionId}`, {
      headers: { "X-API-Key": config.apiKey },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (cause) {
    return { state: "unreachable", detail: cause?.message ?? String(cause) };
  }

  if (response.status === 404) {
    return { state: "missing", detail: `No session named "${config.sessionId}"` };
  }

  if (!response.ok) {
    return { state: "unreachable", detail: `OpenWA returned HTTP ${response.status}` };
  }

  const session = await response.json();
  const status = String(session.status ?? session.data?.status ?? "unknown").toLowerCase();

  // Exact match, not a substring test. OpenWA's SessionStatus values are
  // created / initializing / qr_ready / authenticating / ready / disconnected /
  // failed, and only `ready` can send. A substring check is actively dangerous
  // here: "disconnected" contains "connected" and "qr_ready" contains "ready",
  // so a loose test reports a dead session as healthy — the agent then fails
  // every send and trips the circuit breaker, which is exactly the "looks like a
  // ban but is really an unpaired phone" confusion this function exists to stop.
  return status === "ready"
    ? { state: "connected", detail: status }
    : { state: "disconnected", detail: status };
}

/**
 * Sends one text message. Returns the provider's message id so a delivery can
 * be traced later from the outbox row.
 */
export async function sendText(config, { chatId, text }) {
  const result = await request(config, `/api/sessions/${config.sessionId}/messages/send-text`, {
    chatId,
    text,
  });

  return { providerRef: result.messageId ?? result.id ?? null };
}
