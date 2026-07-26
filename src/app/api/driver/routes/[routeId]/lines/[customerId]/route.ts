import { z } from "zod";
import { requireDriver } from "@/lib/driver-auth";
import { saveDriverLine } from "@/lib/driver-data";
import { driverJson, driverPreflight } from "@/lib/driver-http";
import type { DriverSaveLineResponse } from "@/lib/driver-api-types";

export const runtime = "nodejs";

const saveSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A valid date is required."),
  skipped: z.boolean(),
  remarks: z.string().optional(),
  products: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().min(0),
        rateSnapshot: z.coerce.number().min(0),
      }),
    )
    .default([]),
  location: z
    .object({
      latitude: z.coerce.number().min(-90).max(90),
      longitude: z.coerce.number().min(-180).max(180),
    })
    .optional(),
});

export function OPTIONS() {
  return driverPreflight();
}

export async function POST(
  request: Request,
  context: { params: Promise<{ routeId: string; customerId: string }> },
) {
  const driver = await requireDriver(request);
  if (!driver) {
    return driverJson({ error: "Not signed in." }, 401);
  }

  const { routeId, customerId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return driverJson({ error: "Invalid request body." }, 400);
  }

  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return driverJson({ error: parsed.error.issues[0]?.message ?? "Invalid data." }, 400);
  }

  const result = await saveDriverLine(driver.vehicleId, routeId, customerId, parsed.data.date, {
    skipped: parsed.data.skipped,
    remarks: parsed.data.remarks,
    products: parsed.data.products,
    location: parsed.data.location,
  });

  if (!result.ok) {
    return driverJson({ error: result.error }, 409);
  }

  const response: DriverSaveLineResponse = { ok: true, saved: result.customer };
  return driverJson(response);
}
