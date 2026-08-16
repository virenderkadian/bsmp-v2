"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nextCustomerCode } from "@/lib/customer-code";
import { monthInputToDate } from "@/lib/monthly-route-sequence";
import { prisma } from "@/lib/prisma";

export type BillingRouteOption = {
  routeId: string;
  routeCode: string;
  routeName: string;
  shift: string;
  // True for the route being added right now, so the dialog can label it.
  isNew: boolean;
};

export type BillingRouteChoice = {
  customerId: string;
  customerName: string;
  routeId: string;
  sequenceMonth: string;
  options: BillingRouteOption[];
};

// Narrow state for flows that can never need a billing-route decision — a
// brand-new customer has no other route to clash with. Kept separate so it
// stays assignable to the shared quick-create dialog's expected state.
export type MonthlySequenceQuickCreateState = {
  status: "idle" | "success" | "error";
  message?: string;
  customerId?: string;
};

export type MonthlySequenceActionState = {
  // "needs-billing-route" means nothing was written: the customer already runs
  // on another route this month, so exactly one of those routes has to be
  // chosen to carry their single combined bill before the row is created.
  status: "idle" | "success" | "error" | "needs-billing-route";
  message?: string;
  customerId?: string;
  billingChoice?: BillingRouteChoice;
};

// Typed narrow so it can seed BOTH action shapes — the wide one accepts it,
// the quick-create one requires it.
const idleState: MonthlySequenceQuickCreateState = { status: "idle" };

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

const addSequenceLineSchema = z.object({
  routeId: z.string().trim().min(1, "Select a route first."),
  customerId: z.string().trim().min(1, "Select a customer first."),
  sequenceMonth: z.string().regex(/^\d{4}-\d{2}$/, "Select a valid month."),
  // Present only on the second submit, once the driver of the UI has answered
  // "which route bills this customer?". Empty on the first attempt.
  billingRouteId: z.string().trim().optional(),
});

const quickCreateCustomerSequenceSchema = addSequenceLineSchema
  .omit({ customerId: true })
  .extend({
    name: z.string().trim().min(2, "Customer name is required."),
    area: z.string().trim().optional(),
    mobile: z.string().trim().optional(),
    openingBalance: z.coerce.number().min(0, "Opening balance cannot be negative."),
  });

const sequenceScopeSchema = z.object({
  routeId: z.string().trim().min(1, "Select a route first."),
  sequenceMonth: z.string().regex(/^\d{4}-\d{2}$/, "Select a valid month."),
});

const removeSequenceLineSchema = sequenceScopeSchema.extend({
  lineId: z.string().trim().min(1, "Sequence line is required."),
});

const reorderSequenceLinesSchema = sequenceScopeSchema.extend({
  lineIds: z.array(z.string().trim().min(1)).min(1, "At least one line is required."),
});

function getSequenceSetupErrorMessage(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2021" || error.code === "P2022") {
      return "Monthly sequence table is not ready. Run prisma migration, then reload this page.";
    }
  }

  const message =
    error instanceof Error ? error.message : "Unable to add customer to sequence.";

  if (
    message.includes("aggregate") ||
    message.includes("create") ||
    message.includes("monthlyRouteCustomerSequence") ||
    message.includes("MonthlyRouteCustomerSequence")
  ) {
    return "Monthly sequence model is not ready in the running server. Run prisma generate/migration, then restart dev server.";
  }

  return message;
}

function asOptional(value: string | undefined) {
  return value?.trim() ? value.trim() : undefined;
}

async function resequenceLines(routeId: string, sequenceMonth: Date) {
  const lines = await prisma.monthlyRouteCustomerSequence.findMany({
    where: {
      routeId,
      sequenceMonth,
    },
    orderBy: { sequenceNo: "asc" },
    select: { id: true },
  });

  await updateSequenceOrder(routeId, sequenceMonth, lines.map((line) => line.id));
}

async function updateSequenceOrder(
  routeId: string,
  sequenceMonth: Date,
  lineIds: string[],
) {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.monthlyRouteCustomerSequence.findMany({
      where: {
        routeId,
        sequenceMonth,
      },
      select: {
        id: true,
      },
    });
    const rowIds = new Set(rows.map((row) => row.id));

    if (rows.length !== lineIds.length || lineIds.some((lineId) => !rowIds.has(lineId))) {
      throw new Error("Sequence list changed. Please reload and try again.");
    }

    const temporaryBase = 100000;

    for (const [index, lineId] of lineIds.entries()) {
      await tx.monthlyRouteCustomerSequence.update({
        where: { id: lineId },
        data: { sequenceNo: temporaryBase + index + 1 },
      });
    }

    for (const [index, lineId] of lineIds.entries()) {
      await tx.monthlyRouteCustomerSequence.update({
        where: { id: lineId },
        data: { sequenceNo: index + 1 },
      });
    }
  });
}

export async function addMonthlyRouteSequenceLine(
  _prevState: MonthlySequenceActionState = idleState,
  formData: FormData,
): Promise<MonthlySequenceActionState> {
  void _prevState;

  const parsed = addSequenceLineSchema.safeParse({
    routeId: getValue(formData, "routeId"),
    customerId: getValue(formData, "customerId"),
    sequenceMonth: getValue(formData, "sequenceMonth"),
    billingRouteId: getValue(formData, "billingRouteId"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  const sequenceMonth = monthInputToDate(parsed.data.sequenceMonth);
  const billingRouteId = parsed.data.billingRouteId?.trim() || "";

  // Already on another route this month? Then this add would give them a
  // second route, and a customer gets exactly ONE combined bill — so which
  // route carries it has to be answered before anything is written.
  const otherRoutes = await prisma.monthlyRouteCustomerSequence.findMany({
    where: {
      customerId: parsed.data.customerId,
      sequenceMonth,
      status: "ACTIVE",
      NOT: { routeId: parsed.data.routeId },
    },
    orderBy: { createdAt: "asc" },
    select: { routeId: true, route: { select: { code: true, name: true, shift: true } } },
  });

  if (otherRoutes.length > 0 && !billingRouteId) {
    const [customer, newRoute] = await Promise.all([
      prisma.customer.findUnique({
        where: { id: parsed.data.customerId },
        select: { name: true },
      }),
      prisma.route.findUnique({
        where: { id: parsed.data.routeId },
        select: { code: true, name: true, shift: true },
      }),
    ]);

    if (!newRoute) {
      return { status: "error", message: "That route no longer exists. Reload and try again." };
    }

    return {
      status: "needs-billing-route",
      billingChoice: {
        customerId: parsed.data.customerId,
        customerName: customer?.name ?? "This customer",
        routeId: parsed.data.routeId,
        sequenceMonth: parsed.data.sequenceMonth,
        options: [
          ...otherRoutes.map((row) => ({
            routeId: row.routeId,
            routeCode: row.route.code,
            routeName: row.route.name,
            shift: String(row.route.shift),
            isNew: false,
          })),
          {
            routeId: parsed.data.routeId,
            routeCode: newRoute.code,
            routeName: newRoute.name,
            shift: String(newRoute.shift),
            isNew: true,
          },
        ],
      },
    };
  }

  if (billingRouteId) {
    const isKnownRoute =
      billingRouteId === parsed.data.routeId || otherRoutes.some((row) => row.routeId === billingRouteId);

    if (!isKnownRoute) {
      return {
        status: "error",
        message: "That billing route isn't one of this customer's routes. Reload and try again.",
      };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const maxSequence = await tx.monthlyRouteCustomerSequence.aggregate({
        where: {
          routeId: parsed.data.routeId,
          sequenceMonth,
        },
        _max: {
          sequenceNo: true,
        },
      });

      // Clear every existing flag BEFORE setting the chosen one. The partial
      // unique index allows only one billsHere = true per customer+month and is
      // checked per statement, so flipping the new one on first would collide
      // with the old one mid-transaction.
      if (billingRouteId) {
        await tx.monthlyRouteCustomerSequence.updateMany({
          where: { customerId: parsed.data.customerId, sequenceMonth, status: "ACTIVE" },
          data: { billsHere: false },
        });
      }

      await tx.monthlyRouteCustomerSequence.create({
        data: {
          routeId: parsed.data.routeId,
          customerId: parsed.data.customerId,
          sequenceMonth,
          sequenceNo: (maxSequence._max.sequenceNo ?? 0) + 1,
          status: "ACTIVE",
          // Their only route unless a choice was made — a single-route customer
          // never has to be asked anything.
          billsHere: billingRouteId ? false : true,
        },
      });

      if (billingRouteId) {
        await tx.monthlyRouteCustomerSequence.updateMany({
          where: { customerId: parsed.data.customerId, sequenceMonth, status: "ACTIVE", routeId: billingRouteId },
          data: { billsHere: true },
        });
      }
    });

    revalidatePath("/monthly-route-sequence");
    revalidatePath("/daily-entry");
    // The billing route decides which route's summary and bills this customer
    // shows up under, so that screen's cached data is now stale too.
    revalidatePath("/monthly-bills");

    return {
      status: "success",
      message: billingRouteId
        ? "Customer added. Their bill will be issued on the route you picked."
        : "Customer added to monthly sequence.",
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = Array.isArray(error.meta?.target)
        ? error.meta.target.join(", ")
        : "";

      if (target.includes("customerId")) {
        return {
          status: "error",
          message: "This customer is already added for the selected route and month.",
        };
      }

      return {
        status: "error",
        message: "This sequence was already used. Please reload and try again.",
      };
    }

    return { status: "error", message: getSequenceSetupErrorMessage(error) };
  }
}

export async function createCustomerAndAddToMonthlyRouteSequence(
  _prevState: MonthlySequenceQuickCreateState = idleState,
  formData: FormData,
): Promise<MonthlySequenceQuickCreateState> {
  void _prevState;

  const parsed = quickCreateCustomerSequenceSchema.safeParse({
    routeId: getValue(formData, "routeId"),
    sequenceMonth: getValue(formData, "sequenceMonth"),
    name: getValue(formData, "name"),
    area: getValue(formData, "area"),
    mobile: getValue(formData, "mobile"),
    openingBalance: getValue(formData, "openingBalance"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  const sequenceMonth = monthInputToDate(parsed.data.sequenceMonth);

  try {
    const customer = await prisma.$transaction(async (tx) => {
      // The new customer must belong to the same city as the route they're
      // being added to, not some independently-chosen "current" city.
      const route = await tx.route.findUniqueOrThrow({
        where: { id: parsed.data.routeId },
        select: { cityId: true },
      });

      // See createCustomer in src/app/masters/actions.ts for why this
      // retries on a code conflict instead of surfacing it: two customers
      // created at nearly the same moment could compute the same "next"
      // code before either commits, and the user never typed a code here.
      let createdCustomer: { id: string } | undefined;

      for (let attempt = 0; !createdCustomer; attempt += 1) {
        const code = await nextCustomerCode(tx, route.cityId);

        try {
          createdCustomer = await tx.customer.create({
            data: {
              cityId: route.cityId,
              code,
              name: parsed.data.name,
              area: asOptional(parsed.data.area),
              mobile: asOptional(parsed.data.mobile),
              openingBalance: parsed.data.openingBalance,
              isActive: true,
            },
            select: {
              id: true,
            },
          });
        } catch (error) {
          const isCodeConflict =
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002" &&
            Array.isArray(error.meta?.target) &&
            error.meta.target.includes("code");

          if (!isCodeConflict || attempt >= 4) {
            throw error;
          }
        }
      }

      const maxSequence = await tx.monthlyRouteCustomerSequence.aggregate({
        where: {
          routeId: parsed.data.routeId,
          sequenceMonth,
        },
        _max: {
          sequenceNo: true,
        },
      });

      await tx.monthlyRouteCustomerSequence.create({
        data: {
          routeId: parsed.data.routeId,
          customerId: createdCustomer.id,
          sequenceMonth,
          sequenceNo: (maxSequence._max.sequenceNo ?? 0) + 1,
          status: "ACTIVE",
        },
      });

      return createdCustomer;
    });

    revalidatePath("/customers");
    revalidatePath("/monthly-route-sequence");
    revalidatePath("/daily-entry");

    return {
      status: "success",
      message: "Customer created and added to sequence.",
      customerId: customer.id,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = Array.isArray(error.meta?.target)
        ? error.meta.target.join(", ")
        : "";

      if (target.includes("code")) {
        return {
          status: "error",
          message: "This customer code already exists. Search and add the existing customer instead.",
        };
      }

      return {
        status: "error",
        message: "This customer already exists in the selected route sequence.",
      };
    }

    return { status: "error", message: getSequenceSetupErrorMessage(error) };
  }
}

export async function reorderMonthlyRouteSequenceLines(
  _prevState: MonthlySequenceActionState = idleState,
  formData: FormData,
): Promise<MonthlySequenceActionState> {
  void _prevState;

  const parsed = reorderSequenceLinesSchema.safeParse({
    routeId: getValue(formData, "routeId"),
    sequenceMonth: getValue(formData, "sequenceMonth"),
    lineIds: formData.getAll("lineId").map(String),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  try {
    await updateSequenceOrder(
      parsed.data.routeId,
      monthInputToDate(parsed.data.sequenceMonth),
      parsed.data.lineIds,
    );

    revalidatePath("/monthly-route-sequence");
    revalidatePath("/daily-entry");

    return { status: "success", message: "Sequence updated." };
  } catch (error) {
    return { status: "error", message: getSequenceSetupErrorMessage(error) };
  }
}

export async function removeMonthlyRouteSequenceLine(
  _prevState: MonthlySequenceActionState = idleState,
  formData: FormData,
): Promise<MonthlySequenceActionState> {
  void _prevState;

  const parsed = removeSequenceLineSchema.safeParse({
    routeId: getValue(formData, "routeId"),
    sequenceMonth: getValue(formData, "sequenceMonth"),
    lineId: getValue(formData, "lineId"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  const sequenceMonth = monthInputToDate(parsed.data.sequenceMonth);

  try {
    // Which customer this row belonged to, and whether it was the one carrying
    // their bill — both unknowable once it's deleted.
    const removed = await prisma.monthlyRouteCustomerSequence.findFirst({
      where: { id: parsed.data.lineId, routeId: parsed.data.routeId, sequenceMonth },
      select: { customerId: true, billsHere: true },
    });

    await prisma.monthlyRouteCustomerSequence.deleteMany({
      where: {
        id: parsed.data.lineId,
        routeId: parsed.data.routeId,
        sequenceMonth,
      },
    });

    // Removing the billing row would otherwise leave a customer still running
    // other routes with NO route flagged. That isn't fatal — resolveBillingRoutes
    // falls back to their earliest row — but it silently drops a deliberate
    // choice, so promote the earliest remaining route explicitly instead.
    if (removed?.billsHere) {
      const remaining = await prisma.monthlyRouteCustomerSequence.findFirst({
        where: { customerId: removed.customerId, sequenceMonth, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

      if (remaining) {
        await prisma.monthlyRouteCustomerSequence.update({
          where: { id: remaining.id },
          data: { billsHere: true },
        });
      }
    }

    await resequenceLines(parsed.data.routeId, sequenceMonth);

    revalidatePath("/monthly-route-sequence");
    revalidatePath("/daily-entry");
    revalidatePath("/monthly-bills");

    return { status: "success", message: "Customer removed from sequence." };
  } catch (error) {
    return { status: "error", message: getSequenceSetupErrorMessage(error) };
  }
}
