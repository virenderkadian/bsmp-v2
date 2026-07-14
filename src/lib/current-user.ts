import type { City, User, UserCityAssignment } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = User & {
  cityAssignments: Array<UserCityAssignment & { city: City }>;
};

// Resolves the signed-in Supabase Auth user to their matching public.User
// row (same id, created when a superadmin adds them — see
// src/app/settings/user-actions.ts). Returns null when signed out, or when
// auth exists but the User row hasn't been created/is deactivated.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: authUser.id },
    include: {
      cityAssignments: {
        include: { city: true },
        orderBy: { city: { name: "asc" } },
      },
    },
  });

  if (!user || !user.isActive) {
    return null;
  }

  return user;
}

// Throws rather than returning null/false so every call site fails closed —
// city and user management (src/app/settings/city-actions.ts,
// src/app/settings/user-actions.ts) is superadmin-only, and a missed check
// there would let a city-scoped admin edit global records.
export async function requireSuperadmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!user || user.role !== "SUPERADMIN") {
    throw new Error("Only a superadmin can perform this action.");
  }

  return user;
}
