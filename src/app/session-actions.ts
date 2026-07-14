"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { ACTIVE_CITY_COOKIE } from "@/lib/current-city";
import { getCurrentUser } from "@/lib/current-user";

export async function setActiveCity(cityId: string) {
  const user = await getCurrentUser();

  if (!user) {
    return;
  }

  if (user.role !== "SUPERADMIN") {
    const allowed = user.cityAssignments.some((assignment) => assignment.cityId === cityId);

    if (!allowed) {
      return;
    }
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_CITY_COOKIE, cityId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
}
