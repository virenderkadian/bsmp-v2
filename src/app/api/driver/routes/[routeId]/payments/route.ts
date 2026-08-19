import { z } from "zod";
import { requireDriver } from "@/lib/driver-auth";
import { recordDriverPayment } from "@/lib/driver-data";
import { driverJson, driverPreflight } from "@/lib/driver-http";
import type { DriverPaymentResponse } from "@/lib/driver-api-types";

export const runtime = "nodejs";

const paymentSchema = z.object({
  // A UUID from the client. It becomes the payment's primary key, which is what
  // makes a retry harmless — see recordDriverPayment.
  paymentId: z.string().uuid("A valid payment id is required."),
  customerId: z.string().min(1),
  amount: z.coerce.number().positive("Enter an amount greater than zero."),
  mode: z.enum(["CASH", "UPI"]),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A valid date is required."),
});

export function OPTIONS() {
  return driverPreflight();
}

export async function POST(request: Request, context: { params: Promise<{ routeId: string }> }) {
  const driver = await requireDriver(request);
  if (!driver) {
    return driverJson({ error: "Not signed in." }, 401);
  }

  const { routeId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return driverJson({ error: "Invalid request body." }, 400);
  }

  const parsed = paymentSchema.safeParse(body);
  if (!parsed.success) {
    return driverJson({ error: parsed.error.issues[0]?.message ?? "Invalid data." }, 400);
  }

  const result = await recordDriverPayment(driver.vehicleId, driver.cityId, routeId, parsed.data);

  if (!result.ok) {
    return driverJson({ error: result.error }, 409);
  }

  const response: DriverPaymentResponse = { ok: true, payment: result.payment };
  return driverJson(response);
}
