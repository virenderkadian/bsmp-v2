import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runZoepactBatch } from "@/lib/notifications/zoepact-sender";

// Vercel Cron calls this every minute (vercel.json). It authenticates with
// CRON_SECRET, which Vercel sends as "Authorization: Bearer <secret>" — it is
// not a user session, so /api/cron is a public path in the proxy and this check
// is the only gate. Fails closed: with no CRON_SECRET configured nothing runs.
export const maxDuration = 60;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;

  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runZoepactBatch();
  return NextResponse.json(result);
}
