"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperadmin } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

export type ActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const idleState: ActionState = { status: "idle" };

const roleSchema = z.enum(["SUPERADMIN", "ADMIN", "USER"]);

const createUserSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is required."),
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(6, "Password must be at least 6 characters."),
  role: roleSchema,
  cityIds: z.array(z.string().trim().min(1)),
});

const idSchema = z.string().trim().min(1, "Record id is required.");

const updateUserSchema = z.object({
  id: idSchema,
  fullName: z.string().trim().min(2, "Full name is required."),
  role: roleSchema,
  cityIds: z.array(z.string().trim().min(1)),
});

const activeStateSchema = z.object({
  id: idSchema,
  isActive: z.enum(["true", "false"]),
});

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getCityIds(formData: FormData) {
  return formData.getAll("cityIds").filter((value): value is string => typeof value === "string");
}

function revalidateAll() {
  revalidatePath("/settings");
  revalidatePath("/", "layout");
}

export async function createUser(_prevState: ActionState = idleState, formData: FormData): Promise<ActionState> {
  void _prevState;

  const parsed = createUserSchema.safeParse({
    fullName: getValue(formData, "fullName"),
    email: getValue(formData, "email"),
    password: getValue(formData, "password"),
    role: getValue(formData, "role"),
    cityIds: getCityIds(formData),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  if (parsed.data.role !== "SUPERADMIN" && parsed.data.cityIds.length === 0) {
    return { status: "error", message: "Assign at least one city for an admin or user account." };
  }

  try {
    await requireSuperadmin();

    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
    });

    if (error || !data.user) {
      const message = error?.message ?? "Unable to create the login account.";
      const isDuplicate = /already been registered|already exists/i.test(message);
      return {
        status: "error",
        message: isDuplicate ? "A user with this email already exists." : message,
      };
    }

    try {
      const createdUser = await prisma.user.create({
        data: {
          id: data.user.id,
          fullName: parsed.data.fullName,
          email: parsed.data.email,
          role: parsed.data.role,
          cityAssignments:
            parsed.data.role === "SUPERADMIN"
              ? undefined
              : { create: parsed.data.cityIds.map((cityId) => ({ cityId })) },
        },
      });

      await logAudit(prisma, {
        entityType: "User",
        entityId: createdUser.id,
        action: "CREATE",
        summary: `Created user ${createdUser.fullName} (${createdUser.email}) with role ${createdUser.role}.`,
        after: { fullName: createdUser.fullName, email: createdUser.email, role: createdUser.role, cityIds: parsed.data.cityIds },
      });
    } catch (dbError) {
      // The auth account exists but the app-side row failed — remove the
      // orphaned auth user so the email isn't stuck unusable for retries.
      await admin.auth.admin.deleteUser(data.user.id).catch(() => {});
      throw dbError;
    }

    revalidateAll();
    return { status: "success", message: "User created." };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "error", message: "A user with this email already exists." };
    }

    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { status: "error", message };
  }
}

export async function updateUser(_prevState: ActionState = idleState, formData: FormData): Promise<ActionState> {
  void _prevState;

  const parsed = updateUserSchema.safeParse({
    id: getValue(formData, "id"),
    fullName: getValue(formData, "fullName"),
    role: getValue(formData, "role"),
    cityIds: getCityIds(formData),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  if (parsed.data.role !== "SUPERADMIN" && parsed.data.cityIds.length === 0) {
    return { status: "error", message: "Assign at least one city for an admin or user account." };
  }

  try {
    const currentUser = await requireSuperadmin();

    if (currentUser.id === parsed.data.id && parsed.data.role !== "SUPERADMIN") {
      return { status: "error", message: "You can't remove your own superadmin role." };
    }

    const before = await prisma.user.findUnique({
      where: { id: parsed.data.id },
      select: { fullName: true, role: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: parsed.data.id },
        data: { fullName: parsed.data.fullName, role: parsed.data.role },
      });
      await tx.userCityAssignment.deleteMany({ where: { userId: parsed.data.id } });

      if (parsed.data.role !== "SUPERADMIN") {
        await tx.userCityAssignment.createMany({
          data: parsed.data.cityIds.map((cityId) => ({ userId: parsed.data.id, cityId })),
        });
      }

      await logAudit(tx, {
        entityType: "User",
        entityId: parsed.data.id,
        action: "UPDATE",
        summary: `Updated user ${parsed.data.fullName} (role ${parsed.data.role}).`,
        before,
        after: { fullName: parsed.data.fullName, role: parsed.data.role, cityIds: parsed.data.cityIds },
      });
    });

    revalidateAll();
    return { status: "success", message: "User updated." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { status: "error", message };
  }
}

export async function setUserActiveState(
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

  try {
    const currentUser = await requireSuperadmin();

    if (currentUser.id === parsed.data.id && !nextActiveState) {
      return { status: "error", message: "You can't deactivate your own account." };
    }

    const updatedUser = await prisma.user.update({
      where: { id: parsed.data.id },
      data: { isActive: nextActiveState },
    });

    await logAudit(prisma, {
      entityType: "User",
      entityId: updatedUser.id,
      action: "STATUS_CHANGE",
      summary: `${nextActiveState ? "Activated" : "Deactivated"} user ${updatedUser.fullName}.`,
      after: { isActive: nextActiveState },
    });

    revalidateAll();
    return { status: "success", message: nextActiveState ? "User activated." : "User made inactive." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { status: "error", message };
  }
}
