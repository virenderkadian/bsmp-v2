import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { setCityContext } from "@/lib/city-context";
import { getJwtSecret } from "@/lib/jwt-secret";
import { recordAdminWrite, resolveAdminAccess, resolveAdminVehicle, verifyAdminToken } from "@/lib/admin-app-auth";

// Driver mobile-app auth. Deliberately separate from the Supabase Auth used by
// admin users: a vehicle logs in with its code + a PIN, and carries a signed
// JWT on every /api/driver/* request. The token embeds the vehicle's cityId so
// driver queries get the same city-isolation backstop as the web app.

// ---- PIN hashing (Node scrypt, no dependency) ----

const SCRYPT_KEYLEN = 64;

// Stored as "scrypt$<saltHex>$<hashHex>". A PIN is low-entropy, so the primary
// defense is rate-limiting the login endpoint; scrypt (a deliberately slow KDF)
// raises the cost of an offline crack should a hash ever leak.
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored) {
    return false;
  }
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = scryptSync(pin, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ---- JWT ----

export type DriverTokenPayload = {
  vehicleId: string;
  cityId: string;
  // Present only when an ADMIN is acting on this vehicle (see requireDriver);
  // a real vehicle login never has it.
  admin?: { userId: string; role: string; name: string };
};

// Long-lived by design: a driver logs in once and stays signed in. Rotate the
// secret (or add per-vehicle revocation) if a device is lost.
const TOKEN_TTL = "30d";

export async function signDriverToken(payload: DriverTokenPayload): Promise<string> {
  return new SignJWT({ cityId: payload.cityId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.vehicleId)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(getJwtSecret());
}

export async function verifyDriverToken(token: string): Promise<DriverTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    // An admin token is never a vehicle login, whatever else it carries.
    if (payload.kind !== undefined) {
      return null;
    }
    const vehicleId = payload.sub;
    const cityId = payload.cityId;
    if (typeof vehicleId === "string" && typeof cityId === "string") {
      return { vehicleId, cityId };
    }
    return null;
  } catch {
    return null;
  }
}

// Guard for /api/driver/* handlers: pulls the Bearer token, verifies it, and
// (crucially) sets the request-scoped city context so the Prisma city-isolation
// backstop scopes every subsequent query to this vehicle's city. Returns null
// when unauthenticated — the caller should respond 401.
export async function requireDriver(request: Request): Promise<DriverTokenPayload | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) {
    return null;
  }
  const payload = await verifyDriverToken(token);
  if (payload) {
    setCityContext(payload.cityId);
    return payload;
  }

  // Not a vehicle token: an admin acting on a vehicle. They can do what the
  // vehicle's driver can do. The vehicle comes from the request and is
  // re-checked against the admin's current cities every time, and a write is
  // recorded in the audit trail as THEIRS before it goes through (see
  // recordAdminWrite) — a driver endpoint on its own would attribute it to the
  // vehicle.
  const admin = await verifyAdminToken(token);
  if (!admin) {
    return null;
  }
  const vehicleId = request.headers.get("x-vehicle-id") ?? "";
  const access = await resolveAdminAccess(admin.userId);
  if (!access) {
    return null;
  }
  const vehicle = await resolveAdminVehicle(access, vehicleId);
  if (!vehicle) {
    return null;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    // Fail closed: no unattributed admin write.
    if (!(await recordAdminWrite(access, vehicle, request))) {
      return null;
    }
  }
  setCityContext(vehicle.cityId);
  return { vehicleId: vehicle.vehicleId, cityId: vehicle.cityId, admin: { userId: access.userId, role: access.role, name: access.fullName } };
}
