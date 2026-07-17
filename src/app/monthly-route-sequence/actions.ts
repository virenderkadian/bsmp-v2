"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nextCustomerCode } from "@/lib/customer-code";
import { monthInputToDate } from "@/lib/monthly-route-sequence";
import { prisma } from "@/lib/prisma";

export type MonthlySequenceActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  customerId?: string;
};

const idleState: MonthlySequenceActionState = { status: "idle" };

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

const addSequenceLineSchema = z.object({
  routeId: z.string().trim().min(1, "Select a route first."),
  customerId: z.string().trim().min(1, "Select a customer first."),
  sequenceMonth: z.string().regex(/^\d{4}-\d{2}$/, "Select a valid month."),
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
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  const sequenceMonth = monthInputToDate(parsed.data.sequenceMonth);

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

      await tx.monthlyRouteCustomerSequence.create({
        data: {
          routeId: parsed.data.routeId,
          customerId: parsed.data.customerId,
          sequenceMonth,
          sequenceNo: (maxSequence._max.sequenceNo ?? 0) + 1,
          status: "ACTIVE",
        },
      });
    });

    revalidatePath("/monthly-route-sequence");
    revalidatePath("/daily-entry");

    return { status: "success", message: "Customer added to monthly sequence." };
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
  _prevState: MonthlySequenceActionState = idleState,
  formData: FormData,
): Promise<MonthlySequenceActionState> {
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
    await prisma.monthlyRouteCustomerSequence.deleteMany({
      where: {
        id: parsed.data.lineId,
        routeId: parsed.data.routeId,
        sequenceMonth,
      },
    });
    await resequenceLines(parsed.data.routeId, sequenceMonth);

    revalidatePath("/monthly-route-sequence");
    revalidatePath("/daily-entry");

    return { status: "success", message: "Customer removed from sequence." };
  } catch (error) {
    return { status: "error", message: getSequenceSetupErrorMessage(error) };
  }
}
