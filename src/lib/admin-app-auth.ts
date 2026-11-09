import { jwtVerify, SignJWT } from "jose";
import type { UserRole } from "@prisma/client";
import type { AdminVehicle } from "@/lib/driver-api-types";
import { prisma } from "@/lib/prisma";
import { getJwtSecret } from "@/lib/jwt-secret";

// Admin sign-in for the mobile app.
//
// The web app's admins already exist (Supabase Auth + a User row with a role and
// city assignments). The phone signs in with that same email and password, but
// never holds Supabase credentials: the server checks the password, confirms the
// person is an active ADMIN or SUPERADMIN, and hands back its own short-lived
// token of the same kind the driver app uses. That keeps one auth scheme in the
// app's API layer and lets the existing rate-limit and city-isolation machinery
// apply unchanged.
//
// An admin token is NOT a driver token. It carries `kind: "admin"` and no city;
// the vehicle (and therefore the city) is chosen per request and re-checked
// against the admin's allowed cities every time, so a token alone never grants a
// vehicle.

export const ADMIN_APP_ROLES: UserRole[] = ["SUPERADMIN", "ADMIN"];

// Shorter than a driver's 30 days: an admin can move money, and a phone left
// signed in on someone's desk is the realistic risk.
const ADMIN_TOKEN_TTL = "12h";

export type AdminTokenPayload = { userId: string; role: UserRole };

export async function signAdminToken(payload: AdminTokenPayload): Promise<string> {
  return new SignJWT({ kind: "admin", role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(ADMIN_TOKEN_TTL)
    .sign(getJwtSecret());
}

export async function verifyAdminToken(token: string): Promise<AdminTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (payload.kind !== "admin" || typeof payload.sub !== "string" || typeof payload.role !== "string") {
      return null;
    }
    return { userId: payload.sub, role: payload.role as UserRole };
  } catch {
    return null;
  }
}

export type AdminAccess = {
  userId: string;
  fullName: string;
  role: UserRole;
  // null = every city (superadmin); otherwise only these.
  cityIds: string[] | null;
};

// Re-read on every request, not trusted from the token: deactivating an admin
// or removing a city assignment on the web takes effect immediately, instead of
// when their 12 hours run out.
export async function resolveAdminAccess(userId: string): Promise<AdminAccess | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, role: true, isActive: true, cityAssignments: { select: { cityId: true } } },
  });
  if (!user || !user.isActive || !ADMIN_APP_ROLES.includes(user.role)) return null;
  return {
    userId: user.id,
    fullName: user.fullName,
    role: user.role,
    cityIds: user.role === "SUPERADMIN" ? null : user.cityAssignments.map((assignment) => assignment.cityId),
  };
}


export async function listAdminVehicles(access: AdminAccess): Promise<AdminVehicle[]> {
  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true, ...(access.cityIds ? { cityId: { in: access.cityIds } } : {}) },
    orderBy: [{ city: { name: "asc" } }, { code: "asc" }],
    select: { id: true, code: true, name: true, cityId: true, city: { select: { name: true } } },
  });
  return vehicles.map((vehicle) => ({ id: vehicle.id, code: vehicle.code, name: vehicle.name, cityId: vehicle.cityId, cityName: vehicle.city.name }));
}

// The vehicle an admin is acting on, or null when it does not exist, is inactive,
// or is in a city this admin may not see.
export async function resolveAdminVehicle(access: AdminAccess, vehicleId: string): Promise<{ vehicleId: string; cityId: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(vehicleId)) return null;
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, isActive: true, ...(access.cityIds ? { cityId: { in: access.cityIds } } : {}) },
    select: { id: true, cityId: true },
  });
  return vehicle ? { vehicleId: vehicle.id, cityId: vehicle.cityId } : null;
}

// Records, before it happens, that an admin is making a change on a vehicle's
// behalf. Returns false if the record could not be saved, and the caller must
// then refuse the write.
export async function recordAdminWrite(access: AdminAccess, vehicle: { vehicleId: string; cityId: string }, request: Request): Promise<boolean> {
  try {
    const path = new URL(request.url).pathname;
    await prisma.auditLog.create({
      data: {
        cityId: vehicle.cityId,
        actorId: access.userId,
        actorName: access.fullName,
        actorRole: access.role,
        entityType: "Vehicle",
        entityId: vehicle.vehicleId,
        action: `ADMIN_APP_${request.method}`,
        summary: `${access.fullName} (${access.role}) made a ${request.method} request on this vehicle from the mobile app: ${path}`,
      },
    });
    return true;
  } catch (error) {
    console.error("Could not record admin write", error);
    return false;
  }
}

// Guard for the admin-only endpoints (not vehicle-scoped): a valid admin token
// whose user is still an active admin. Null means respond 401.
export async function requireAdmin(request: Request): Promise<AdminAccess | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return null;
  const payload = await verifyAdminToken(token);
  return payload ? resolveAdminAccess(payload.userId) : null;
}
