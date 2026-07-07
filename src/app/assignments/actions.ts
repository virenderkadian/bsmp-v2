"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export type AssignmentActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const idleState: AssignmentActionState = { status: "idle" };

const assignmentSchema = z.object({
  routeId: z.string().trim().min(1, "Route is required."),
  customerId: z.string().trim().min(1, "Customer is required."),
  sequenceNo: z.coerce.number().int().positive("Sequence must be 1 or greater."),
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

const defaultSchema = z.object({
  assignmentId: z.string().trim().min(1, "Assignment is required."),
  productId: z.string().trim().min(1, "Product is required."),
  defaultQty: z.coerce.number().positive("Default quantity must be greater than zero."),
  defaultRate: z.coerce.number().positive("Default rate must be greater than zero."),
});

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return "That record already exists. Please review route, customer, and sequence values.";
    }
  }

  return error instanceof Error ? error.message : "Something went wrong.";
}

async function runAction(
  action: () => Promise<void>,
  successMessage: string,
): Promise<AssignmentActionState> {
  try {
    await action();
    revalidatePath("/assignments");
    revalidatePath("/routes");
    return { status: "success", message: successMessage };
  } catch (error) {
    return { status: "error", message: getErrorMessage(error) };
  }
}

const idSchema = z.string().trim().min(1, "Record id is required.");

export async function createAssignment(
  _prevState: AssignmentActionState = idleState,
  formData: FormData,
): Promise<AssignmentActionState> {
  void _prevState;

  const parsed = assignmentSchema.safeParse({
    routeId: getValue(formData, "routeId"),
    customerId: getValue(formData, "customerId"),
    sequenceNo: getValue(formData, "sequenceNo"),
    status: getValue(formData, "status"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    await prisma.routeCustomerAssignment.create({
      data: parsed.data,
    });
  }, "Customer assigned to route.");
}

export async function updateAssignment(
  _prevState: AssignmentActionState = idleState,
  formData: FormData,
): Promise<AssignmentActionState> {
  void _prevState;

  const parsed = assignmentSchema.extend({ id: idSchema }).safeParse({
    id: getValue(formData, "id"),
    routeId: getValue(formData, "routeId"),
    customerId: getValue(formData, "customerId"),
    sequenceNo: getValue(formData, "sequenceNo"),
    status: getValue(formData, "status"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    await prisma.routeCustomerAssignment.update({
      where: { id: parsed.data.id },
      data: {
        routeId: parsed.data.routeId,
        customerId: parsed.data.customerId,
        sequenceNo: parsed.data.sequenceNo,
        status: parsed.data.status,
      },
    });
  }, "Assignment updated.");
}

export async function createAssignmentDefault(
  _prevState: AssignmentActionState = idleState,
  formData: FormData,
): Promise<AssignmentActionState> {
  void _prevState;

  const parsed = defaultSchema.safeParse({
    assignmentId: getValue(formData, "assignmentId"),
    productId: getValue(formData, "productId"),
    defaultQty: getValue(formData, "defaultQty"),
    defaultRate: getValue(formData, "defaultRate"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    await prisma.routeCustomerProductDefault.create({
      data: parsed.data,
    });
  }, "Default product added to assignment.");
}

export async function updateAssignmentDefault(
  _prevState: AssignmentActionState = idleState,
  formData: FormData,
): Promise<AssignmentActionState> {
  void _prevState;

  const parsed = defaultSchema.extend({ id: idSchema }).safeParse({
    id: getValue(formData, "id"),
    assignmentId: getValue(formData, "assignmentId"),
    productId: getValue(formData, "productId"),
    defaultQty: getValue(formData, "defaultQty"),
    defaultRate: getValue(formData, "defaultRate"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    await prisma.routeCustomerProductDefault.update({
      where: { id: parsed.data.id },
      data: {
        assignmentId: parsed.data.assignmentId,
        productId: parsed.data.productId,
        defaultQty: parsed.data.defaultQty,
        defaultRate: parsed.data.defaultRate,
      },
    });
  }, "Assignment default updated.");
}
