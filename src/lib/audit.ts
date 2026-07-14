import "server-only";
import type { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/current-user";

// Structural rather than PrismaClient/TransactionClient directly — the
// city-scope guard in src/lib/prisma.ts wraps the client in $extends(),
// which gives every call site (both the global client and a $transaction
// callback's tx) a type that's structurally compatible but not nominally
// identical to Prisma's own client/transaction-client types. Depending only
// on the one method this helper actually calls sidesteps that mismatch.
type AuditClient = {
  auditLog: {
    create: (args: { data: Prisma.AuditLogUncheckedCreateInput }) => Promise<unknown>;
  };
};

export type AuditInput = {
  cityId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  summary: string;
  before?: unknown;
  after?: unknown;
};

// Writes one audit trail row. Accepts either the global `prisma` client or a
// `$transaction` callback's `tx`, so a call site whose underlying operation
// is itself transactional can log atomically with it. Never throws — a
// failed audit write must not take down the business operation it's
// describing; it's swallowed and logged to the server console instead.
export async function logAudit(client: AuditClient, input: AuditInput) {
  try {
    const user = await getCurrentUser();

    await client.auditLog.create({
      data: {
        cityId: input.cityId ?? null,
        actorId: user?.id ?? null,
        actorName: user?.fullName ?? "System",
        actorRole: user?.role ?? "SYSTEM",
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        action: input.action,
        summary: input.summary,
        before: input.before === undefined ? undefined : (input.before as Prisma.InputJsonValue),
        after: input.after === undefined ? undefined : (input.after as Prisma.InputJsonValue),
      },
    });
  } catch (error) {
    console.error("Failed to write audit log:", error);
  }
}
