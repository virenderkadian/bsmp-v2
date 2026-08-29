import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isNotificationsEnabled } from "@/lib/notifications/config";

// Auth for the office-PC sender agent. Deliberately simpler than the driver
// app's JWT scheme (src/lib/driver-auth.ts): there is exactly one agent, it is
// a server not a person, it holds no user identity, and it never expires a
// session — so a single long shared secret is the right shape. Anything more
// would be ceremony without benefit.
//
// The secret is a bearer credential in cleartext over the wire, which is fine
// because the agent talks to Vercel over HTTPS. It must never be given to a
// browser.

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  // timingSafeEqual throws on length mismatch, which would itself leak length.
  // Comparing lengths first and returning the same way keeps the check total.
  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export type AgentAuthFailure = { response: NextResponse };

// Returns null when the caller is authorised, or a ready-to-return response
// when it is not. Callers must return that response — failing open here would
// expose the queue (and every customer's phone number) to the internet.
export function requireAgent(request: Request): AgentAuthFailure | null {
  if (!isNotificationsEnabled()) {
    // 404 rather than 403: when the feature is off these routes should look
    // like they do not exist, not like a locked door worth rattling.
    return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  const secret = process.env.NOTIFICATIONS_AGENT_SECRET;

  if (!secret || secret.length < 32) {
    console.error("NOTIFICATIONS_AGENT_SECRET is missing or too short (needs 32+ characters).");
    return { response: NextResponse.json({ error: "Not configured" }, { status: 503 }) };
  }

  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token || !constantTimeEquals(token, secret)) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return null;
}
