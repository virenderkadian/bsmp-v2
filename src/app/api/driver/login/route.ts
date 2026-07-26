import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPin, signDriverToken, verifyPin } from "@/lib/driver-auth";
import { driverJson, driverPreflight } from "@/lib/driver-http";
import { checkDriverLoginRateLimit, getClientIp, recordDriverLoginAttempt } from "@/lib/driver-rate-limit";
import type { DriverLoginResponse } from "@/lib/driver-api-types";

export const runtime = "nodejs"; // scrypt needs the Node runtime, not edge.

const loginSchema = z.object({
  vehicleCode: z.string().trim().min(1),
  pin: z.string().trim().min(4),
});

// A well-formed hash to verify against when no vehicle matches, so an unknown
// vehicle code takes the same time as a wrong PIN (no timing oracle).
const DUMMY_HASH = hashPin("timing-normalizer");

export function OPTIONS() {
  return driverPreflight();
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return driverJson({ error: "Invalid request body." }, 400);
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return driverJson({ error: "Vehicle code and PIN are required." }, 400);
  }

  const { vehicleCode, pin } = parsed.data;
  const ipAddress = getClientIp(request);

  // Checked BEFORE verifying the PIN, not after: the lockout limits attempt
  // volume, not correctness — a correct PIN submitted while locked out must
  // still be rejected, or the lock would do nothing against a lucky guess.
  const rateLimit = await checkDriverLoginRateLimit(vehicleCode, ipAddress);
  if (rateLimit.limited) {
    return driverJson(
      { error: "Too many attempts. Try again in a few minutes." },
      429,
      { "Retry-After": String(rateLimit.retryAfterSeconds) },
    );
  }

  // No city context is set here, so this query is intentionally unscoped and
  // can find the vehicle across cities. Vehicle codes are unique per city, so
  // we verify the PIN against every code match and require exactly one success.
  const candidates = await prisma.vehicle.findMany({
    where: { code: vehicleCode, isActive: true, pinHash: { not: null } },
    select: { id: true, code: true, name: true, cityId: true, pinHash: true },
  });

  if (candidates.length === 0) {
    verifyPin(pin, DUMMY_HASH); // normalize timing
    await recordDriverLoginAttempt(vehicleCode, ipAddress, false);
    return driverJson({ error: "Invalid vehicle code or PIN." }, 401);
  }

  const matches = candidates.filter((vehicle) => verifyPin(pin, vehicle.pinHash));

  // Exactly one match logs in. Zero (wrong PIN) or more than one (same code+PIN
  // across cities — vanishingly unlikely) both get the same generic rejection.
  if (matches.length !== 1) {
    await recordDriverLoginAttempt(vehicleCode, ipAddress, false);
    return driverJson({ error: "Invalid vehicle code or PIN." }, 401);
  }

  await recordDriverLoginAttempt(vehicleCode, ipAddress, true);

  const vehicle = matches[0];
  const token = await signDriverToken({ vehicleId: vehicle.id, cityId: vehicle.cityId });

  const response: DriverLoginResponse = {
    token,
    vehicle: { id: vehicle.id, code: vehicle.code, name: vehicle.name, cityId: vehicle.cityId },
  };
  return driverJson(response);
}
