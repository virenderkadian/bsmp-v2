import { z } from "zod";
import { requireDriver } from "@/lib/driver-auth";
import { updateDriverCustomerMobile } from "@/lib/driver-data";
import { driverJson, driverPreflight } from "@/lib/driver-http";
import type { DriverUpdateCustomerResponse } from "@/lib/driver-api-types";

export const runtime = "nodejs";

// Only `mobile` is accepted. A driver-authenticated request must not be able to
// reach any other customer field, so the shape itself is the restriction rather
// than a check inside the handler.
const updateSchema = z.object({
  mobile: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s]{6,20}$/, "Enter a valid phone number.")
    .nullable(),
});

export function OPTIONS() {
  return driverPreflight();
}

export async function PATCH(request: Request, context: { params: Promise<{ customerId: string }> }) {
  const driver = await requireDriver(request);
  if (!driver) {
    return driverJson({ error: "Not signed in." }, 401);
  }

  const { customerId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return driverJson({ error: "Invalid request body." }, 400);
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return driverJson({ error: parsed.error.issues[0]?.message ?? "Invalid data." }, 400);
  }

  const result = await updateDriverCustomerMobile(driver.cityId, customerId, parsed.data.mobile);

  if (!result.ok) {
    return driverJson({ error: result.error }, 404);
  }

  const response: DriverUpdateCustomerResponse = { ok: true, customer: result.customer };
  return driverJson(response);
}
