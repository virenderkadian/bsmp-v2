"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { getCurrentCityId } from "@/lib/current-city";
import { monthInputToDate } from "@/lib/monthly-route-sequence";
import { prisma } from "@/lib/prisma";

export type BillingRouteActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const idleState: BillingRouteActionState = { status: "idle" };

const setBillingRouteSchema = z.object({
  customerId: z.string().trim().min(1, "Customer is required."),
  routeId: z.string().trim().min(1, "Select a route."),
  sequenceMonth: z.string().regex(/^\d{4}-\d{2}$/, "Select a valid month."),
});

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

// Moves a customer's single combined bill onto a different one of the routes
// they run that month. Deliveries are unaffected — only where the bill appears.
export async function setBillingRoute(
  _prevState: BillingRouteActionState = idleState,
  formData: FormData,
): Promise<BillingRouteActionState> {
  void _prevState;

  const parsed = setBillingRouteSchema.safeParse({
    customerId: getValue(formData, "customerId"),
    routeId: getValue(formData, "routeId"),
    sequenceMonth: getValue(formData, "sequenceMonth"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  const sequenceMonth = monthInputToDate(parsed.data.sequenceMonth);

  // Past months are viewable but not editable. The panel hides the controls,
  // which is presentation, not protection — this is the check that holds. A
  // past month is already billed, so moving where its bill sits would rewrite
  // history rather than fix anything.
  const now = new Date();
  const currentMonthKey = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 7);

  if (parsed.data.sequenceMonth < currentMonthKey) {
    return {
      status: "error",
      message: "That month has already been billed. Billing routes can only be changed from the current month onward.",
    };
  }

  try {
    const cityId = await getCurrentCityId();

    const rows = await prisma.monthlyRouteCustomerSequence.findMany({
      where: {
        customerId: parsed.data.customerId,
        sequenceMonth,
        status: "ACTIVE",
        route: { cityId },
      },
      orderBy: { createdAt: "asc" },
      select: { routeId: true, billsHere: true, route: { select: { code: true } } },
    });

    const target = rows.find((row) => row.routeId === parsed.data.routeId);
    if (!target) {
      return {
        status: "error",
        message: "That route isn't one of this customer's routes for the month. Reload and try again.",
      };
    }

    // Same guard the rest of the app applies to money: once a bill is issued,
    // moving which route it belongs to would strand the already-generated
    // document on a route the customer is no longer billed under.
    const frozenBill = await prisma.monthlyBill.findFirst({
      where: {
        customerId: parsed.data.customerId,
        billingMonth: sequenceMonth,
        status: { in: ["GENERATED", "LOCKED"] },
      },
      select: { status: true, route: { select: { code: true } } },
    });

    if (frozenBill) {
      return {
        status: "error",
        message: `This customer's bill for the month is already ${
          frozenBill.status === "LOCKED" ? "locked" : "generated"
        } on ${frozenBill.route.code}. Reopen it to a draft before moving the billing route.`,
      };
    }

    const previous = rows.find((row) => row.billsHere);
    if (previous?.routeId === parsed.data.routeId) {
      return { status: "success", message: "Already billed on that route." };
    }

    await prisma.$transaction(async (tx) => {
      // Clear first, then set — the partial unique index permits only one
      // billsHere = true per customer+month and is checked per statement.
      await tx.monthlyRouteCustomerSequence.updateMany({
        where: { customerId: parsed.data.customerId, sequenceMonth, status: "ACTIVE" },
        data: { billsHere: false },
      });
      await tx.monthlyRouteCustomerSequence.updateMany({
        where: {
          customerId: parsed.data.customerId,
          sequenceMonth,
          status: "ACTIVE",
          routeId: parsed.data.routeId,
        },
        data: { billsHere: true },
      });

      await logAudit(tx, {
        cityId,
        entityType: "MonthlyRouteCustomerSequence",
        entityId: parsed.data.customerId,
        action: "BILLING_ROUTE_CHANGED",
        summary: `Billing route for ${parsed.data.sequenceMonth} moved to ${target.route.code}`,
        before: { routeCode: previous?.route.code ?? null },
        after: { routeCode: target.route.code },
      });
    });

    revalidatePath("/settings");
    revalidatePath("/monthly-bills");
    revalidatePath("/monthly-route-sequence");

    return { status: "success", message: `Now billed on ${target.route.code}.` };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to change the billing route.",
    };
  }
}
