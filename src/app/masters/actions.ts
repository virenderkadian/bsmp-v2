"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export type ActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const idleState: ActionState = { status: "idle" };

const optionalDisplayOrderSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().int().min(0, "Display order cannot be negative.").optional(),
);

const productSchema = z.object({
  code: z.string().trim().min(1, "Code is required."),
  name: z.string().trim().min(2, "Name is required."),
  shortName: z.string().trim().max(24, "Short name should be 24 characters or less.").optional(),
  unit: z.string().trim().min(1, "Unit is required."),
  defaultRate: z.coerce.number().positive("Default rate must be greater than zero."),
  displayOrder: optionalDisplayOrderSchema,
  showInDailyEntry: z.boolean().optional(),
});

const vehicleSchema = z.object({
  code: z.string().trim().min(2, "Code is required."),
  name: z.string().trim().min(2, "Vehicle name is required."),
  registration: z.string().trim().optional(),
});

const routeSchema = z.object({
  code: z.string().trim().min(2, "Code is required."),
  name: z.string().trim().min(2, "Route name is required."),
  shift: z.enum(["MORNING", "EVENING"]),
  vehicleId: z.string().trim().optional(),
  driverName: z.string().trim().optional(),
  driverPhone: z.string().trim().optional(),
});

const customerSchema = z.object({
  code: z.string().trim().min(2, "Code is required."),
  name: z.string().trim().min(2, "Customer name is required."),
  area: z.string().trim().optional(),
  mobile: z.string().trim().optional(),
  openingBalance: z.coerce.number().min(0, "Opening balance cannot be negative."),
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

function asOptional(value: string) {
  return value.trim() === "" ? undefined : value.trim();
}

function asNullable(value: string) {
  return value.trim() === "" ? null : value.trim();
}

async function runAction(action: () => Promise<void>, successMessage: string): Promise<ActionState> {
  try {
    await action();
    revalidatePath("/masters");
    revalidatePath("/products");
    revalidatePath("/customers");
    revalidatePath("/routes");
    revalidatePath("/daily-entry");
    revalidatePath("/monthly-route-sequence");
    revalidatePath("/monthly-bills");
    return { status: "success", message: successMessage };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        const target = Array.isArray(error.meta?.target) ? error.meta.target.join(", ") : "unique field";

        if (target.includes("code")) {
          return {
            status: "error",
            message: "This code already exists. Please use a different code.",
          };
        }

        return {
          status: "error",
          message: `A record with the same ${target} already exists.`,
        };
      }
    }

    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { status: "error", message };
  }
}

export async function createProduct(_prevState: ActionState = idleState, formData: FormData): Promise<ActionState> {
  void _prevState;
  const parsed = productSchema.safeParse({
    code: getValue(formData, "code"),
    name: getValue(formData, "name"),
    shortName: formData.has("shortName") ? getValue(formData, "shortName") : undefined,
    unit: getValue(formData, "unit"),
    defaultRate: getValue(formData, "defaultRate"),
    displayOrder: formData.has("displayOrder") ? getValue(formData, "displayOrder") : undefined,
    showInDailyEntry: formData.has("showInDailyEntry")
      ? getValue(formData, "showInDailyEntry") === "true"
      : undefined,
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    const nextDisplayOrder =
      parsed.data.displayOrder ??
      ((await prisma.product.aggregate({
        _max: {
          displayOrder: true,
        },
      }))._max.displayOrder ?? 0) + 1;

    await prisma.product.create({
      data: {
        code: parsed.data.code,
        name: parsed.data.name,
        shortName: asNullable(parsed.data.shortName ?? ""),
        unit: parsed.data.unit,
        defaultRate: parsed.data.defaultRate,
        displayOrder: nextDisplayOrder,
        showInDailyEntry: parsed.data.showInDailyEntry ?? true,
      },
    });
  }, "Product created.");
}

export async function updateProduct(_prevState: ActionState = idleState, formData: FormData): Promise<ActionState> {
  void _prevState;
  const parsed = productSchema.extend({ id: idSchema }).safeParse({
    id: getValue(formData, "id"),
    code: getValue(formData, "code"),
    name: getValue(formData, "name"),
    shortName: formData.has("shortName") ? getValue(formData, "shortName") : undefined,
    unit: getValue(formData, "unit"),
    defaultRate: getValue(formData, "defaultRate"),
    displayOrder: formData.has("displayOrder") ? getValue(formData, "displayOrder") : undefined,
    showInDailyEntry: formData.has("showInDailyEntry")
      ? getValue(formData, "showInDailyEntry") === "true"
      : undefined,
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    const updateData: Prisma.ProductUpdateInput = {
      code: parsed.data.code,
      name: parsed.data.name,
      unit: parsed.data.unit,
      defaultRate: parsed.data.defaultRate,
    };

    if (parsed.data.shortName !== undefined) {
      updateData.shortName = asNullable(parsed.data.shortName);
    }

    if (parsed.data.displayOrder !== undefined) {
      updateData.displayOrder = parsed.data.displayOrder;
    }

    if (parsed.data.showInDailyEntry !== undefined) {
      updateData.showInDailyEntry = parsed.data.showInDailyEntry;
    }

    await prisma.product.update({
      where: { id: parsed.data.id },
      data: updateData,
    });
  }, "Product updated.");
}

export async function createVehicle(_prevState: ActionState = idleState, formData: FormData): Promise<ActionState> {
  void _prevState;
  const parsed = vehicleSchema.safeParse({
    code: getValue(formData, "code"),
    name: getValue(formData, "name"),
    registration: getValue(formData, "registration"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    await prisma.vehicle.create({
      data: {
        code: parsed.data.code,
        name: parsed.data.name,
        registration: asOptional(parsed.data.registration ?? ""),
      },
    });
  }, "Vehicle created.");
}

export async function updateVehicle(_prevState: ActionState = idleState, formData: FormData): Promise<ActionState> {
  void _prevState;
  const parsed = vehicleSchema.extend({ id: idSchema }).safeParse({
    id: getValue(formData, "id"),
    code: getValue(formData, "code"),
    name: getValue(formData, "name"),
    registration: getValue(formData, "registration"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    await prisma.vehicle.update({
      where: { id: parsed.data.id },
      data: {
        code: parsed.data.code,
        name: parsed.data.name,
        registration: asOptional(parsed.data.registration ?? ""),
      },
    });
  }, "Vehicle updated.");
}

export async function createRoute(_prevState: ActionState = idleState, formData: FormData): Promise<ActionState> {
  void _prevState;
  const parsed = routeSchema.safeParse({
    code: getValue(formData, "code"),
    name: getValue(formData, "name"),
    shift: getValue(formData, "shift"),
    vehicleId: getValue(formData, "vehicleId"),
    driverName: getValue(formData, "driverName"),
    driverPhone: getValue(formData, "driverPhone"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    await prisma.route.create({
      data: {
        code: parsed.data.code,
        name: parsed.data.name,
        shift: parsed.data.shift,
        vehicleId: asOptional(parsed.data.vehicleId ?? ""),
        driverName: asNullable(parsed.data.driverName ?? ""),
        driverPhone: asNullable(parsed.data.driverPhone ?? ""),
      },
    });
  }, "Route created.");
}

export async function updateRoute(_prevState: ActionState = idleState, formData: FormData): Promise<ActionState> {
  void _prevState;
  const parsed = routeSchema.extend({ id: idSchema }).safeParse({
    id: getValue(formData, "id"),
    code: getValue(formData, "code"),
    name: getValue(formData, "name"),
    shift: getValue(formData, "shift"),
    vehicleId: getValue(formData, "vehicleId"),
    driverName: getValue(formData, "driverName"),
    driverPhone: getValue(formData, "driverPhone"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    await prisma.route.update({
      where: { id: parsed.data.id },
      data: {
        code: parsed.data.code,
        name: parsed.data.name,
        shift: parsed.data.shift,
        vehicleId: asOptional(parsed.data.vehicleId ?? ""),
        driverName: asNullable(parsed.data.driverName ?? ""),
        driverPhone: asNullable(parsed.data.driverPhone ?? ""),
      },
    });
  }, "Route updated.");
}

export async function createCustomer(_prevState: ActionState = idleState, formData: FormData): Promise<ActionState> {
  void _prevState;
  const parsed = customerSchema.safeParse({
    code: getValue(formData, "code"),
    name: getValue(formData, "name"),
    area: getValue(formData, "area"),
    mobile: getValue(formData, "mobile"),
    openingBalance: getValue(formData, "openingBalance"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    await prisma.customer.create({
      data: {
        code: parsed.data.code,
        name: parsed.data.name,
        area: asOptional(parsed.data.area ?? ""),
        mobile: asOptional(parsed.data.mobile ?? ""),
        openingBalance: parsed.data.openingBalance,
      },
    });
  }, "Customer created.");
}

export async function updateCustomer(_prevState: ActionState = idleState, formData: FormData): Promise<ActionState> {
  void _prevState;
  const parsed = customerSchema.extend({ id: idSchema }).safeParse({
    id: getValue(formData, "id"),
    code: getValue(formData, "code"),
    name: getValue(formData, "name"),
    area: getValue(formData, "area"),
    mobile: getValue(formData, "mobile"),
    openingBalance: getValue(formData, "openingBalance"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  return runAction(async () => {
    await prisma.customer.update({
      where: { id: parsed.data.id },
      data: {
        code: parsed.data.code,
        name: parsed.data.name,
        area: asOptional(parsed.data.area ?? ""),
        mobile: asOptional(parsed.data.mobile ?? ""),
        openingBalance: parsed.data.openingBalance,
      },
    });
  }, "Customer updated.");
}

export async function setCustomerActiveState(
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
      await prisma.customer.update({
        where: { id: parsed.data.id },
        data: {
          isActive: nextActiveState,
        },
      });
    },
    nextActiveState ? "Customer activated." : "Customer made inactive.",
  );
}

export async function setProductActiveState(
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
      await prisma.product.update({
        where: { id: parsed.data.id },
        data: {
          isActive: nextActiveState,
        },
      });
    },
    nextActiveState ? "Product activated." : "Product made inactive.",
  );
}

export async function setRouteActiveState(
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
      await prisma.route.update({
        where: { id: parsed.data.id },
        data: {
          isActive: nextActiveState,
        },
      });
    },
    nextActiveState ? "Route activated." : "Route made inactive.",
  );
}

export async function setVehicleActiveState(
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
      await prisma.vehicle.update({
        where: { id: parsed.data.id },
        data: {
          isActive: nextActiveState,
        },
      });
    },
    nextActiveState ? "Vehicle activated." : "Vehicle made inactive.",
  );
}
