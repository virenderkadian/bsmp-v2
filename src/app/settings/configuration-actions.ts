"use server";

import { revalidatePath } from "next/cache";
import { getCurrentCityId } from "@/lib/current-city";
import { getCurrentUser } from "@/lib/current-user";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { setCitySetting } from "@/lib/city-settings";
import { CITY_SETTING_LABELS, isCitySettingKey } from "@/lib/city-settings.shared";

export type ActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  // Distinguishes two identical results, so flipping a switch back and forth
  // is acknowledged each time rather than swallowed as a repeat.
  token?: string;
};

const idleState: ActionState = { status: "idle" };

// Configuration changes how bills and sheets read, so it is audited like any
// other setting that affects what a customer is handed.
export async function updateCitySetting(
  _prevState: ActionState = idleState,
  formData: FormData,
): Promise<ActionState> {
  void _prevState;

  const key = String(formData.get("key") ?? "");
  const value = String(formData.get("value") ?? "") === "true";
  const token = crypto.randomUUID();

  if (!isCitySettingKey(key)) {
    return { status: "error", message: "That setting does not exist.", token };
  }

  try {
    const user = await getCurrentUser();

    if (!user || (user.role !== "ADMIN" && user.role !== "SUPERADMIN")) {
      return { status: "error", message: "Only an admin can change configuration.", token };
    }

    const cityId = await getCurrentCityId();
    await setCitySetting(cityId, key, value);
    await logAudit(prisma, {
      cityId,
      entityType: "CitySetting",
      entityId: key,
      action: "UPDATE",
      summary: `${CITY_SETTING_LABELS[key].label} turned ${value ? "on" : "off"}.`,
      after: { key, value },
    });

    revalidatePath("/settings");
    revalidatePath("/monthly-bills");

    return { status: "success", message: value ? "Turned on." : "Turned off.", token };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not save that setting.",
      token,
    };
  }
}
