import { listAdminVehicles, requireAdmin } from "@/lib/admin-app-auth";
import { driverJson, driverPreflight } from "@/lib/driver-http";
import type { AdminVehiclesResponse } from "@/lib/driver-api-types";

export const runtime = "nodejs";

export function OPTIONS() {
  return driverPreflight();
}

// The vehicles this admin may act on: every city for a superadmin, only their
// assigned cities for anyone else.
export async function GET(request: Request) {
  const access = await requireAdmin(request);
  if (!access) {
    return driverJson({ error: "Not signed in." }, 401);
  }
  const response: AdminVehiclesResponse = { vehicles: await listAdminVehicles(access) };
  return driverJson(response);
}
