"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { getCurrentCityId } from "@/lib/current-city";
import { isPlausibleCoordinate } from "@/lib/customer-location-math";
import { prisma } from "@/lib/prisma";

export type CustomerLocationActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const idleState: CustomerLocationActionState = { status: "idle" };

const schema = z.object({
  customerId: z.string().trim().min(1),
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
});

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

// Corrects a customer's saved location.
//
// The driver app captures this from the first delivery that gets a GPS fix and
// then never overwrites it, so a bad capture is permanent until someone fixes
// it here — that was the gap this screen exists to close.
export async function updateCustomerLocation(
  _prevState: CustomerLocationActionState = idleState,
  formData: FormData,
): Promise<CustomerLocationActionState> {
  void _prevState;

  const parsed = schema.safeParse({
    customerId: getValue(formData, "customerId"),
    latitude: getValue(formData, "latitude"),
    longitude: getValue(formData, "longitude"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid location." };
  }

  if (!isPlausibleCoordinate(parsed.data.latitude, parsed.data.longitude)) {
    return { status: "error", message: "That doesn't look like a real location." };
  }

  try {
    const cityId = await getCurrentCityId();

    const existing = await prisma.customer.findFirst({
      where: { id: parsed.data.customerId, cityId },
      select: { id: true, code: true, name: true, latitude: true, longitude: true },
    });

    if (!existing) {
      return { status: "error", message: "Customer not found." };
    }

    await prisma.customer.update({
      where: { id: existing.id },
      data: { latitude: parsed.data.latitude, longitude: parsed.data.longitude },
    });

    // Audited because it changes where a driver is sent on every future visit,
    // and a wrong correction is otherwise indistinguishable from a bad capture
    // after the fact.
    await logAudit(prisma, {
      cityId,
      entityType: "Customer",
      entityId: existing.id,
      action: "LOCATION_UPDATED",
      summary: `Moved saved location for ${existing.code} (${existing.name})`,
      before: { latitude: existing.latitude?.toString() ?? null, longitude: existing.longitude?.toString() ?? null },
      after: { latitude: String(parsed.data.latitude), longitude: String(parsed.data.longitude) },
    });

    revalidatePath("/customers/map");

    return { status: "success", message: `Location updated for ${existing.code}.` };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to update the location.",
    };
  }
}
