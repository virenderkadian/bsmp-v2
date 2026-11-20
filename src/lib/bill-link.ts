import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getJwtSecret } from "@/lib/jwt-secret";

// The signed token inside a WhatsApp "View bill" link: https://…/b/<token>.
//
// Anyone holding the link can open that ONE bill with no login, so the token has
// to be unguessable and unforgeable. It is deliberately NOT a JWT: this goes into
// a WhatsApp URL button, where a short value is safer, and 36 bytes is all it
// takes — the bill id, an expiry, and a truncated HMAC over both.
//
//   token = base64url( billId(16 bytes) | expiry(4 bytes, unix seconds) | mac(16 bytes) )
//
// A 128-bit MAC cannot be brute-forced, so no rate limiter is needed to protect
// it, and an invalid token is rejected here without touching the database.
// Signed with the same server secret as the mobile tokens but a different
// domain-separation prefix, so a bill token can never be mistaken for one of
// those (nor the reverse).

export const BILL_LINK_TTL_DAYS = 60;
const PREFIX = "bill-link:v1:";
const MAC_BYTES = 16;

function mac(payload: Buffer): Buffer {
  return createHmac("sha256", Buffer.from(getJwtSecret()))
    .update(PREFIX)
    .update(payload)
    .digest()
    .subarray(0, MAC_BYTES);
}

export function signBillLink(billId: string, options?: { now?: number; ttlDays?: number }): string {
  const hex = billId.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    throw new Error("A bill link needs a bill UUID.");
  }
  const expiry = Buffer.alloc(4);
  const seconds = Math.floor((options?.now ?? Date.now()) / 1000) + (options?.ttlDays ?? BILL_LINK_TTL_DAYS) * 86_400;
  expiry.writeUInt32BE(seconds);

  const payload = Buffer.concat([Buffer.from(hex, "hex"), expiry]);
  return Buffer.concat([payload, mac(payload)]).toString("base64url");
}

export type BillLinkCheck = { ok: true; billId: string } | { ok: false; reason: "invalid" | "expired" };

export function verifyBillLink(token: string, now = Date.now()): BillLinkCheck {
  // base64url of exactly 36 bytes is 48 characters; refuse anything else early.
  if (!/^[A-Za-z0-9_-]{48}$/.test(token)) {
    return { ok: false, reason: "invalid" };
  }
  const bytes = Buffer.from(token, "base64url");
  if (bytes.length !== 36) {
    return { ok: false, reason: "invalid" };
  }

  const payload = bytes.subarray(0, 20);
  const given = bytes.subarray(20);
  const expected = mac(payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "invalid" };
  }

  if (payload.readUInt32BE(16) * 1000 < now) {
    return { ok: false, reason: "expired" };
  }

  const hex = payload.subarray(0, 16).toString("hex");
  const billId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { ok: true, billId };
}
