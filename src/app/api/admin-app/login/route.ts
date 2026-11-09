import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveAdminAccess, signAdminToken } from "@/lib/admin-app-auth";
import { driverJson, driverPreflight } from "@/lib/driver-http";
import { checkDriverLoginRateLimit, getClientIp, recordDriverLoginAttempt } from "@/lib/driver-rate-limit";
import type { AdminLoginResponse } from "@/lib/driver-api-types";

export const runtime = "nodejs";

const loginSchema = z.object({
  email: z.string().trim().min(1).email(),
  password: z.string().min(1),
});

// One message for every failure — wrong password, unknown email, an account that
// is not an active admin — so the response never says which accounts exist.
const REJECTED = "Incorrect email or password.";

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
    return driverJson({ error: "Email and password are required." }, 400);
  }

  const email = parsed.data.email.toLowerCase();
  const ipAddress = getClientIp(request);
  // The same Postgres-backed limiter the driver login uses, keyed by account
  // instead of vehicle code, and checked BEFORE the password is verified.
  const limiterKey = `admin:${email}`;
  const rateLimit = await checkDriverLoginRateLimit(limiterKey, ipAddress);
  if (rateLimit.limited) {
    return driverJson(
      { error: "Too many attempts. Try again in a few minutes." },
      429,
      { "Retry-After": String(rateLimit.retryAfterSeconds) },
    );
  }

  // A throwaway, stateless client: this only asks Supabase "is this password
  // right?". Nothing from it is stored or sent to the phone.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });
  if (error || !data.user) {
    await recordDriverLoginAttempt(limiterKey, ipAddress, false);
    return driverJson({ error: REJECTED }, 401);
  }

  const access = await resolveAdminAccess(data.user.id);
  if (!access) {
    await recordDriverLoginAttempt(limiterKey, ipAddress, false);
    return driverJson({ error: REJECTED }, 401);
  }

  await recordDriverLoginAttempt(limiterKey, ipAddress, true);
  const token = await signAdminToken({ userId: access.userId, role: access.role });
  const response: AdminLoginResponse = { token, user: { id: access.userId, name: access.fullName, role: access.role } };
  return driverJson(response);
}
