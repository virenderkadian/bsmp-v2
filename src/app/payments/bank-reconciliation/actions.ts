"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentCityId } from "@/lib/current-city";
import { getCurrentUser } from "@/lib/current-user";
import { logAudit } from "@/lib/audit";

export type BankReconciliationActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  // How many of the submitted rows were actually written — a row whose exact
  // (customer, amount, date, narration) already exists is skipped rather than
  // recorded twice, so this can be lower than what was submitted without
  // that being an error.
  recorded?: number;
  skipped?: number;
};

const confirmedRowSchema = z.object({
  customerId: z.string().trim().min(1),
  routeId: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
  paymentDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"]),
  narration: z.string().trim().max(500).optional(),
});

const recordSchema = z.object({
  rows: z.array(confirmedRowSchema).min(1, "Nothing to record."),
});

// Money confirmed from a bank statement — the statement itself is the proof
// it arrived, so once a human has confirmed which customer it belongs to,
// these go straight to VERIFIED rather than sitting in PENDING like a
// driver's own claim would.
export async function recordBankStatementPayments(
  _prevState: BankReconciliationActionState,
  formData: FormData,
): Promise<BankReconciliationActionState> {
  void _prevState;

  const raw = formData.get("rows");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(typeof raw === "string" ? raw : "");
  } catch {
    return { status: "error", message: "Could not read the confirmed rows. Please try again." };
  }

  const parsed = recordSchema.safeParse({ rows: parsedJson });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid data." };
  }

  try {
    const cityId = await getCurrentCityId();
    const collectedBy = await getCurrentUser();

    // Every customer+route named by a row must actually belong to this city,
    // or a crafted payload could file money against another city's customer.
    const customerIds = [...new Set(parsed.data.rows.map((row) => row.customerId))];
    const validCustomers = await prisma.customer.findMany({
      where: { id: { in: customerIds }, cityId },
      select: { id: true },
    });
    if (validCustomers.length !== customerIds.length) {
      return { status: "error", message: "One or more matched customers are outside this city." };
    }

    const routeIds = [...new Set(parsed.data.rows.map((row) => row.routeId))];
    const validRoutes = await prisma.route.findMany({
      where: { id: { in: routeIds }, cityId },
      select: { id: true },
    });
    if (validRoutes.length !== routeIds.length) {
      return { status: "error", message: "One or more matched routes are outside this city." };
    }

    let recorded = 0;
    let skipped = 0;

    await prisma.$transaction(async (transaction) => {
      for (const row of parsed.data.rows) {
        const paymentDate = new Date(`${row.paymentDate}T00:00:00.000Z`);
        const referenceNo = row.narration?.slice(0, 200);

        // Re-uploading the same statement file must not record the same row
        // twice — a prior import of this exact (customer, amount, date,
        // narration) already covers it.
        const existing = await transaction.payment.findFirst({
          where: {
            customerId: row.customerId,
            amount: row.amount,
            paymentDate,
            referenceNo: referenceNo || null,
          },
          select: { id: true },
        });

        if (existing) {
          skipped += 1;
          continue;
        }

        const payment = await transaction.payment.create({
          data: {
            customerId: row.customerId,
            routeId: row.routeId,
            amount: row.amount,
            paymentDate,
            mode: row.mode,
            status: "VERIFIED",
            referenceNo,
            notes: "Matched from an uploaded bank statement.",
            collectedById: collectedBy?.id ?? null,
          },
        });

        await logAudit(transaction, {
          cityId,
          entityType: "Payment",
          entityId: payment.id,
          action: "CREATE",
          summary: `Matched ₹${payment.amount} from a bank statement to customer ${payment.customerId}.`,
          after: payment,
        });

        recorded += 1;
      }
    });

    revalidatePath("/payments");
    revalidatePath("/payments/bank-reconciliation");
    revalidatePath("/monthly-bills");
    revalidatePath("/reconciliation");

    const message =
      skipped > 0
        ? `Recorded ${recorded} payment${recorded === 1 ? "" : "s"}, skipped ${skipped} already recorded from an earlier import.`
        : `Recorded ${recorded} payment${recorded === 1 ? "" : "s"}.`;

    return { status: "success", message, recorded, skipped };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { status: "error", message };
  }
}
