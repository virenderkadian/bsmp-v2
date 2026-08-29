// Customer.mobile is free text entered by office staff and drivers, so it
// arrives in every shape people write phone numbers in: "9812345678",
// "+91 98123 45678", "098123-45678". WhatsApp needs one canonical form, and a
// number that is merely *wrong* must be caught here at queue time — where it
// shows up in the skipped list and someone can fix it — rather than at send
// time two days into a run, where it becomes a failed row nobody looks at.

const INDIA_COUNTRY_CODE = "91";

// Indian mobile numbers are 10 digits beginning 6-9. Landlines and the various
// 1800/1860 service numbers are not reachable on WhatsApp, so rejecting them
// here is correct rather than over-strict.
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

export type NormalizedPhone =
  | { ok: true; msisdn: string }
  | { ok: false; reason: string };

// Returns the E.164 digits without the "+" (e.g. "919812345678"), which is what
// both OpenWA's chatId and Meta's Cloud API expect as the recipient.
export function normalizeIndianMobile(raw: string | null | undefined): NormalizedPhone {
  if (!raw || !raw.trim()) {
    return { ok: false, reason: "No mobile number" };
  }

  const digits = raw.replace(/\D/g, "");

  if (!digits) {
    return { ok: false, reason: "Mobile number has no digits" };
  }

  // Accept the three common ways an Indian mobile gets written down, and
  // nothing else — silently "fixing" an unrecognised shape risks messaging a
  // stranger, which is worse than skipping the row.
  let local: string;

  if (digits.length === 10) {
    local = digits;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    local = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith(INDIA_COUNTRY_CODE)) {
    local = digits.slice(2);
  } else {
    return { ok: false, reason: `Unrecognised number format (${digits.length} digits)` };
  }

  if (!INDIAN_MOBILE.test(local)) {
    return { ok: false, reason: "Not a valid Indian mobile number" };
  }

  return { ok: true, msisdn: `${INDIA_COUNTRY_CODE}${local}` };
}

// OpenWA addresses individual chats as "<msisdn>@c.us" (groups use "@g.us").
// Kept next to normalization so the one place that knows WhatsApp's addressing
// format is not scattered across the agent and the app.
export function toWhatsAppChatId(msisdn: string): string {
  return `${msisdn}@c.us`;
}
