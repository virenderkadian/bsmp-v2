import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/notifications/agent-auth";
import { claimPending, getQueueDepth } from "@/lib/notifications/dispatch";

// The office-PC sender agent's only source of work.
//
// POST rather than GET because claiming mutates — it marks rows SENDING and
// consumes an attempt. A GET here would be cacheable and retry-safe by
// convention, and it is neither.
export async function POST(request: Request) {
  const failure = requireAgent(request);
  if (failure) return failure.response;

  let limit = 25;

  try {
    const body = (await request.json()) as { limit?: number };
    if (typeof body.limit === "number" && body.limit > 0) {
      // Capped so a misconfigured agent cannot claim the whole queue and then
      // die holding it — those rows would be stuck until their lease expires.
      limit = Math.min(body.limit, 50);
    }
  } catch {
    // No body is fine; the default batch size applies.
  }

  const messages = await claimPending(limit);
  const depth = await getQueueDepth();

  return NextResponse.json({
    messages,
    remaining: depth.pending,
    // The agent enforces its daily cap against this rather than its own tally,
    // so restarting the office PC mid-run cannot reset the count.
    sentToday: depth.sentToday,
  });
}
