"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperadmin } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

export type ActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const idleState: ActionState = { status: "idle" };

const citySchema = z.object({
  code: z.string().trim().min(2, "Code is required."),
  name: z.string().trim().min(2, "City name is required."),
});

const idSchema = z.string().trim().min(1, "Record id is required.");

const activeStateSchema = z.object({
  id: idSchema,
  isActive: z.enum(["true", "false"]),
});

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function runAction(action: () => Promise<void>, successMessage: string): Promise<ActionState> {
  try {
    await action();
    revalidatePath("/settings");
    revalidatePath("/", "layout");
    return { status: "success", message: successMessage };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "error", message: "This city code already exists. Please use a different code." };
    }

    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { status: "error", message };
  }
}

export async function createCity(_prevState: ActionState = idleState, formData: FormData): Promise<ActionState> {
  void _prevState;
  const parsed = citySchema.safeParse({
    code: getValue(formData, "code"),
    name: getValue(formData, "name"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    await requireSuperadmin();
    const city = await prisma.city.create({
      data: { code: parsed.data.code.toUpperCase(), name: parsed.data.name },
    });

    await logAudit(prisma, {
      cityId: city.id,
      entityType: "City",
      entityId: city.id,
      action: "CREATE",
      summary: `Created city ${city.name} (${city.code}).`,
      after: city,
    });
  }, "City created.");
}

export async function updateCity(_prevState: ActionState = idleState, formData: FormData): Promise<ActionState> {
  void _prevState;
  const parsed = citySchema.extend({ id: idSchema }).safeParse({
    id: getValue(formData, "id"),
    code: getValue(formData, "code"),
    name: getValue(formData, "name"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    await requireSuperadmin();
    const before = await prisma.city.findUnique({ where: { id: parsed.data.id } });
    const after = await prisma.city.update({
      where: { id: parsed.data.id },
      data: { code: parsed.data.code.toUpperCase(), name: parsed.data.name },
    });

    await logAudit(prisma, {
      cityId: after.id,
      entityType: "City",
      entityId: after.id,
      action: "UPDATE",
      summary: `Updated city ${after.name} (${after.code}).`,
      before,
      after,
    });
  }, "City updated.");
}

export async function setCityActiveState(
  _prevState: ActionState = idleState,
  formData: FormData,
): Promise<ActionState> {
  void _prevState;

  const parsed = activeStateSchema.safeParse({
    id: getValue(formData, "id"),
    isActive: getValue(formData, "isActive"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  const nextActiveState = parsed.data.isActive === "true";

  return runAction(
    async () => {
      await requireSuperadmin();
      const city = await prisma.city.update({
        where: { id: parsed.data.id },
        data: { isActive: nextActiveState },
      });

      await logAudit(prisma, {
        cityId: city.id,
        entityType: "City",
        entityId: city.id,
        action: "STATUS_CHANGE",
        summary: `${nextActiveState ? "Activated" : "Deactivated"} city ${city.name}.`,
        after: { isActive: nextActiveState },
      });
    },
    nextActiveState ? "City activated." : "City made inactive.",
  );
}
