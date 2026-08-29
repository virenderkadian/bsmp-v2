import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAgent } from "@/lib/notifications/agent-auth";
import { reportOutcomes, type DispatchOutcome } from "@/lib/notifications/dispatch";

const outcomeSchema = z.discriminatedUnion("ok", [
  z.object({ id: z.string().uuid(), ok: z.literal(true), providerRef: z.string().optional() }),
  z.object({
    id: z.uuid(),
    ok: z.literal(false),
    error: z.string().max(1000),
    // The agent decides this: "not a WhatsApp number" is permanent, a socket
    // timeout is not. Getting it wrong only costs retries, so the safe default
    // when the agent is unsure is to omit it and let the attempt budget apply.
    permanent: z.boolean().optional(),
    // Set when the agent never reached the gateway, so the message was never
    // actually attempted and its attempt counter is refunded.
    released: z.boolean().optional(),
  }),
]);

const bodySchema = z.object({ outcomes: z.array(outcomeSchema).min(1).max(50) });

// The agent reports here after each batch. Kept separate from /claim so a
// crash between sending and reporting leaves an unambiguous trail: the rows
// stay SENDING until their lease expires, then return to PENDING.
export async function POST(request: Request) {
  const failure = requireAgent(request);
  if (failure) return failure.response;

  let parsed;

  try {
    parsed = bodySchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }

  const result = await reportOutcomes(parsed.data.outcomes as DispatchOutcome[]);

  return NextResponse.json(result);
}
