import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { setCityContext } from "@/lib/city-context";

export const ACTIVE_CITY_COOKIE = "active-city-id";

// Every query and action reads "what city" through this one function rather
// than resolving it themselves — superadmins can switch freely (persisted in
// a cookie), everyone else is pinned to their assigned city/cities. As a
// side effect it also populates the request-scoped city context that
// src/lib/prisma.ts's query guard reads, so every caller of this function
// automatically gets the cross-city-leak backstop with no call-site changes.
export async function getCurrentCityId(): Promise<string> {
  const cityId = await resolveCurrentCityId();
  setCityContext(cityId);
  return cityId;
}

async function resolveCurrentCityId(): Promise<string> {
  const user = await getCurrentUser();
  const cookieStore = await cookies();
  const cookieCityId = cookieStore.get(ACTIVE_CITY_COOKIE)?.value;

  if (!user) {
    // Middleware blocks unauthenticated access to every route except
    // /login, so this only happens for something like a background job —
    // fall back to the first city rather than throwing.
    const firstCity = await prisma.city.findFirst({ orderBy: { name: "asc" } });

    if (!firstCity) {
      throw new Error("No city exists yet — create one before using the app.");
    }

    return firstCity.id;
  }

  if (user.role === "SUPERADMIN") {
    if (cookieCityId) {
      return cookieCityId;
    }

    const firstCity = await prisma.city.findFirst({ orderBy: { name: "asc" } });

    if (!firstCity) {
      throw new Error("No city exists yet — create one in Settings first.");
    }

    return firstCity.id;
  }

  const assignedCityIds = user.cityAssignments.map((assignment) => assignment.cityId);

  if (assignedCityIds.length === 0) {
    throw new Error("Your account isn't assigned to any city yet. Ask a superadmin to assign one.");
  }

  if (cookieCityId && assignedCityIds.includes(cookieCityId)) {
    return cookieCityId;
  }

  return assignedCityIds[0];
}
