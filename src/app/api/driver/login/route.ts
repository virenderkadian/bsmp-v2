import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPin, signDriverToken, verifyPin } from "@/lib/driver-auth";
import { driverJson, driverPreflight } from "@/lib/driver-http";
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

// SECURITY TODO (before production driver rollout): add rate-limiting / lockout
// on this endpoint. It must be backed by a shared store (DB or Upstash), not
// in-memory — serverless instances don't share memory. Until then the defenses
// are scrypt's cost and the generic error below.
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

  // No city context is set here, so this query is intentionally unscoped and
  // can find the vehicle across cities. Vehicle codes are unique per city, so
  // we verify the PIN against every code match and require exactly one success.
  const candidates = await prisma.vehicle.findMany({
    where: { code: parsed.data.vehicleCode, isActive: true, pinHash: { not: null } },
    select: { id: true, code: true, name: true, cityId: true, pinHash: true },
  });

  if (candidates.length === 0) {
    verifyPin(parsed.data.pin, DUMMY_HASH); // normalize timing
    return driverJson({ error: "Invalid vehicle code or PIN." }, 401);
  }

  const matches = candidates.filter((vehicle) => verifyPin(parsed.data.pin, vehicle.pinHash));

  // Exactly one match logs in. Zero (wrong PIN) or more than one (same code+PIN
  // across cities — vanishingly unlikely) both get the same generic rejection.
  if (matches.length !== 1) {
    return driverJson({ error: "Invalid vehicle code or PIN." }, 401);
  }

  const vehicle = matches[0];
  const token = await signDriverToken({ vehicleId: vehicle.id, cityId: vehicle.cityId });

  const response: DriverLoginResponse = {
    token,
    vehicle: { id: vehicle.id, code: vehicle.code, name: vehicle.name, cityId: vehicle.cityId },
  };
  return driverJson(response);
}
