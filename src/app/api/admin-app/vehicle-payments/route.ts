import { z } from "zod";
import { requireAdminVehicle } from "@/lib/admin-app-auth";
import { driverJson, driverPreflight } from "@/lib/driver-http";
import { listVehiclePayments, recordVehiclePayment, VehiclePaymentError } from "@/lib/vehicle-payments";
import type { AdminVehiclePaymentsResponse } from "@/lib/driver-api-types";

export const runtime = "nodejs";

export function OPTIONS() {
  return driverPreflight();
}

// Admin only, for the vehicle named in x-vehicle-id (and only if the admin may
// see it). A vehicle's own driver has no way in: a driver token is not an admin
// token.
export async function GET(request: Request) {
  const context = await requireAdminVehicle(request);
  if (!context) return driverJson({ error: "Not signed in." }, 401);
  const cycleDate = new URL(request.url).searchParams.get("cycleDate") ?? "";
  try {
    const response: AdminVehiclePaymentsResponse = { cycleDate, payments: await listVehiclePayments(context.vehicle, cycleDate) };
    return driverJson(response);
  } catch (error) {
    if (error instanceof VehiclePaymentError) return driverJson({ error: error.message }, error.status);
    console.error("Vehicle payments read failed", error);
    return driverJson({ error: "Could not load payments." }, 500);
  }
}

const schema = z.object({
  requestId: z.string(),
  cycleDate: z.string(),
  amount: z.string(),
  mode: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"]),
  referenceNo: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(request: Request) {
  const context = await requireAdminVehicle(request);
  if (!context) return driverJson({ error: "Not signed in." }, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return driverJson({ error: "Invalid payment." }, 400);
  try {
    const payment = await recordVehiclePayment(context.access, context.vehicle, parsed.data);
    return driverJson({ ok: true, payment });
  } catch (error) {
    if (error instanceof VehiclePaymentError) return driverJson({ error: error.message }, error.status);
    console.error("Vehicle payment save failed", error);
    return driverJson({ error: "Could not record the payment. Please try again." }, 500);
  }
}
