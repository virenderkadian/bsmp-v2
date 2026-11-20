// Client for the Zoepact WhatsApp Business API (the official Meta Cloud API,
// resold). https://dash.zoepact.com/client/api-docs
//
// Deliberately thin and dependency-free: one function per endpoint we use, a
// shared request helper, and — the part that matters — a classification of
// every failure into what the outbox should DO about it:
//
//   config     our key/account is wrong (401/403). Nothing is wrong with the
//              message, so the caller must give the attempt back and stop the
//              batch rather than failing every customer in the queue.
//   invalid    this message will never succeed (400/404: bad number, unknown
//              template, wrong header type). Permanent — do not retry.
//   transient  the API did not take it (429, or a read that failed). Safe to
//              retry later.
//   ambiguous  a SEND that may or may not have gone out (timeout, dropped
//              connection, 5xx). There is no idempotency key in the API, so a
//              blind retry could message a customer twice. The caller should
//              not auto-retry these.
//
// Reads the key from ZOEPACT_API_KEY at call time. It must never be logged, put
// in a URL, or returned to the browser.

const BASE_URL = "https://dash.zoepact.com/api/v1";
const REQUEST_TIMEOUT_MS = 15_000;

export type ZoepactFailure = {
  ok: false;
  kind: "config" | "invalid" | "transient" | "ambiguous";
  status?: number;
  message: string;
};

export type ZoepactResult<T> = { ok: true; data: T } | ZoepactFailure;

type Method = "GET" | "POST" | "DELETE";

async function request(method: Method, path: string, body?: unknown): Promise<ZoepactResult<unknown>> {
  const key = process.env.ZOEPACT_API_KEY;
  if (!key) {
    return { ok: false, kind: "config", message: "ZOEPACT_API_KEY is not set." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // A failed GET changed nothing, so it is just transient; a failed POST may have
  // been processed before the connection dropped.
  const unreachable: ZoepactFailure["kind"] = method === "GET" ? "transient" : "ambiguous";

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { "X-API-Key": key, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return { ok: false, kind: unreachable, message: timedOut ? "Zoepact did not answer in time." : "Could not reach Zoepact." };
  } finally {
    clearTimeout(timer);
  }

  type Envelope = { success?: boolean; data?: unknown; message?: string };
  let json = null as Envelope | null;
  try {
    json = (await response.json()) as Envelope;
  } catch {
    json = null;
  }
  const message = json?.message ?? `Zoepact responded ${response.status}.`;

  if (response.ok && json?.success !== false) {
    return { ok: true, data: json?.data ?? null };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, kind: "config", status: response.status, message };
  }
  if (response.status === 400 || response.status === 404 || response.status === 422) {
    return { ok: false, kind: "invalid", status: response.status, message };
  }
  if (response.status === 429) {
    return { ok: false, kind: "transient", status: response.status, message };
  }
  // 5xx, or a 200 carrying success:false we can't interpret: for a send we
  // can't know whether it went out.
  return { ok: false, kind: unreachable, status: response.status, message };
}

// The docs don't show the response body, only that the send endpoints return a
// message id ("id = message_id returned by any send endpoint"). Read it
// defensively so a field rename degrades to "sent, no reference" rather than to
// a crash after the customer has already been messaged.
function pickId(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  for (const field of ["message_id", "id", "wa_message_id"]) {
    const value = record[field];
    if (typeof value === "string" && value) return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

export type SendTemplateInput = {
  // Country code, no plus: 919876543210 (see normalizeIndianMobile).
  phone: string;
  templateName: string;
  // e.g. "en", "hi", "en_US" — must match the approved template's language.
  language: string;
  // Values for the body's {{1}}, {{2}} ... in order. Meta rejects empty values.
  variables: string[];
  // For a template whose header is a document/image: a PUBLIC https link (Meta
  // downloads it itself), and the type must match the approved header type.
  headerMedia?: { type: "document" | "image" | "video"; link: string; filename?: string };
  // For a dynamic button, e.g. a "View bill" URL button whose {{1}} is a token.
  buttonVariables?: Array<{ index: number; sub_type: "url" | "quick_reply" | "copy_code"; text: string }>;
};

export async function sendTemplate(input: SendTemplateInput): Promise<ZoepactResult<{ messageId?: string }>> {
  if (!/^\d{10,15}$/.test(input.phone)) {
    return { ok: false, kind: "invalid", message: "Phone must be digits with country code, no plus." };
  }
  if (input.variables.some((value) => value.trim() === "")) {
    return { ok: false, kind: "invalid", message: "A template value is empty." };
  }
  // Meta rejects a value with a line break, a tab or a long run of spaces.
  if (input.variables.some((value) => /[\n\r\t]/.test(value) || / {5,}/.test(value))) {
    return { ok: false, kind: "invalid", message: "A template value must be a single line." };
  }

  const result = await request("POST", "/messages/template", {
    phone: input.phone,
    template_name: input.templateName,
    language: input.language,
    variables: input.variables,
    ...(input.headerMedia ? { header_media: input.headerMedia } : {}),
    ...(input.buttonVariables ? { button_variables: input.buttonVariables } : {}),
  });
  return result.ok ? { ok: true, data: { messageId: pickId(result.data) } } : result;
}

export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

const STATUSES: readonly MessageStatus[] = ["pending", "sent", "delivered", "read", "failed"];

export async function getMessageStatus(
  messageId: string,
): Promise<ZoepactResult<{ status: MessageStatus; error?: string }>> {
  const result = await request("GET", `/messages/${encodeURIComponent(messageId)}`);
  if (!result.ok) return result;

  const record = (result.data && typeof result.data === "object" ? result.data : {}) as Record<string, unknown>;
  const status = typeof record.status === "string" ? record.status.toLowerCase() : "";
  if (!(STATUSES as readonly string[]).includes(status)) {
    return { ok: false, kind: "transient", message: "Zoepact returned an unrecognised message status." };
  }
  return { ok: true, data: { status: status as MessageStatus, error: typeof record.error === "string" ? record.error : undefined } };
}

// Prepaid wallet. Checked before a batch so a drained balance pauses sending
// instead of failing half the queue. The response shape isn't shown in the docs,
// so look for a numeric balance under the likely names.
export async function getWalletBalance(): Promise<ZoepactResult<{ balance: number }>> {
  const result = await request("GET", "/wallet");
  if (!result.ok) return result;

  const record = (result.data && typeof result.data === "object" ? result.data : {}) as Record<string, unknown>;
  for (const field of ["balance", "wallet_balance", "amount"]) {
    const value = Number(record[field]);
    if (record[field] !== undefined && record[field] !== null && Number.isFinite(value)) {
      return { ok: true, data: { balance: value } };
    }
  }
  return { ok: false, kind: "transient", message: "Could not read the wallet balance from Zoepact." };
}

// ---- Template management ----
//
// Create -> Meta review is one call. The docs give no response bodies, so each
// reader below accepts the plausible shapes (a bare array, or {templates: []})
// and returns only the fields the screen needs.

export type RemoteTemplate = {
  id: string;
  name: string;
  status: "approved" | "pending" | "rejected" | "unknown";
  category: string;
  language: string;
  rejectionReason?: string;
};

function toRemoteTemplate(value: unknown): RemoteTemplate | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : "";
  const id = record.id !== undefined && record.id !== null ? String(record.id) : "";
  if (!name || !id) return null;

  const raw = typeof record.status === "string" ? record.status.toLowerCase() : "";
  const status: RemoteTemplate["status"] =
    raw === "approved" || raw === "pending" || raw === "rejected" ? raw : "unknown";
  const reason = record.rejection_reason ?? record.rejectionReason;

  return {
    id,
    name,
    status,
    category: typeof record.category === "string" ? record.category.toLowerCase() : "",
    language: typeof record.language === "string" ? record.language : "",
    ...(typeof reason === "string" && reason ? { rejectionReason: reason } : {}),
  };
}

export async function listTemplates(): Promise<ZoepactResult<RemoteTemplate[]>> {
  const result = await request("GET", "/templates?limit=500");
  if (!result.ok) return result;

  const items = Array.isArray(result.data)
    ? result.data
    : result.data && typeof result.data === "object" && Array.isArray((result.data as { templates?: unknown }).templates)
      ? ((result.data as { templates: unknown[] }).templates)
      : [];
  return { ok: true, data: items.map(toRemoteTemplate).filter((item): item is RemoteTemplate => item !== null) };
}

export type CreateTemplateInput = {
  name: string;
  category: "utility" | "marketing";
  language: string;
  body: string;
  footer?: string;
  buttons?: Array<{ type: "url" | "quick_reply" | "phone" | "copy_code"; text: string; value?: string; example?: string }>;
};

export async function createTemplate(input: CreateTemplateInput): Promise<ZoepactResult<{ template: RemoteTemplate | null }>> {
  const result = await request("POST", "/templates", input);
  return result.ok ? { ok: true, data: { template: toRemoteTemplate(result.data) } } : result;
}

// Re-send an existing template to Meta for review (after an edit, or a rejection).
export async function submitTemplate(id: string): Promise<ZoepactResult<{ template: RemoteTemplate | null }>> {
  const result = await request("POST", `/templates/${encodeURIComponent(id)}/submit`, {});
  return result.ok ? { ok: true, data: { template: toRemoteTemplate(result.data) } } : result;
}

// Pull every template's current status from Meta into the panel.
export async function syncTemplates(): Promise<ZoepactResult<null>> {
  const result = await request("POST", "/templates/sync", {});
  return result.ok ? { ok: true, data: null } : result;
}

export async function deleteTemplate(id: string): Promise<ZoepactResult<null>> {
  const result = await request("DELETE", `/templates/${encodeURIComponent(id)}`);
  return result.ok ? { ok: true, data: null } : result;
}
