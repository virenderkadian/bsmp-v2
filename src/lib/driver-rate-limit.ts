import { prisma } from "@/lib/prisma";

// Rate limiting for POST /api/driver/login, backed by Postgres (no Redis/Upstash
// in this project, and login volume is far too low to need one). Two limits:
//
//   - per VEHICLE CODE: stops brute-forcing one vehicle's 4-6 digit PIN. This is
//     the realistic threat — codes are short and guessable ("VH-04").
//   - per IP: stops one attacker rotating through many vehicle codes to dodge
//     the per-code limit.
//
// The caller must check isRateLimited() BEFORE verifying the PIN, not after —
// otherwise a lucky correct guess while locked out would still succeed, which
// defeats the point of a lockout (it limits attempt volume, not correctness).

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_VEHICLE = 5;
const MAX_ATTEMPTS_PER_IP = 20;
// Prune anything old enough that it can no longer affect any active window.
const PRUNE_OLDER_THAN_MS = WINDOW_MS * 4;

export type RateLimitResult = { limited: false } | { limited: true; retryAfterSeconds: number };

export async function checkDriverLoginRateLimit(
  vehicleCode: string,
  ipAddress: string | null,
): Promise<RateLimitResult> {
  const since = new Date(Date.now() - WINDOW_MS);

  const [vehicleAttempts, ipAttempts] = await Promise.all([
    prisma.driverLoginAttempt.findMany({
      where: { vehicleCode, success: false, createdAt: { gte: since } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
      take: MAX_ATTEMPTS_PER_VEHICLE,
    }),
    ipAddress
      ? prisma.driverLoginAttempt.findMany({
          where: { ipAddress, success: false, createdAt: { gte: since } },
          select: { createdAt: true },
          orderBy: { createdAt: "asc" },
          take: MAX_ATTEMPTS_PER_IP,
        })
      : Promise.resolve([]),
  ]);

  // The oldest attempt within the window is what determines when the window
  // clears — retry-after is measured from that attempt's age, not "now".
  const limitFrom = (attempts: { createdAt: Date }[], max: number) => {
    if (attempts.length < max) return null;
    const oldest = attempts[0].createdAt.getTime();
    return Math.max(1, Math.ceil((oldest + WINDOW_MS - Date.now()) / 1000));
  };

  const vehicleRetry = limitFrom(vehicleAttempts, MAX_ATTEMPTS_PER_VEHICLE);
  const ipRetry = limitFrom(ipAttempts, MAX_ATTEMPTS_PER_IP);

  if (vehicleRetry !== null || ipRetry !== null) {
    return { limited: true, retryAfterSeconds: Math.max(vehicleRetry ?? 0, ipRetry ?? 0) };
  }
  return { limited: false };
}

export async function recordDriverLoginAttempt(
  vehicleCode: string,
  ipAddress: string | null,
  success: boolean,
): Promise<void> {
  await prisma.driverLoginAttempt.create({
    data: { vehicleCode, ipAddress, success },
  });

  // Opportunistic cleanup — cheap at this volume, avoids needing a cron job.
  // Not awaited-critical: a failure here shouldn't fail the login request.
  prisma.driverLoginAttempt
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - PRUNE_OLDER_THAN_MS) } } })
    .catch(() => undefined);
}

// Vercel forwards the original client IP in x-forwarded-for (first entry when
// there are multiple proxies). Returns null if absent (e.g. local dev without
// a proxy in front) — the per-vehicle limit alone still applies.
export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return null;
  return forwarded.split(",")[0]?.trim() || null;
}
