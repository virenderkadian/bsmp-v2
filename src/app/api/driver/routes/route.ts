import { requireDriver } from "@/lib/driver-auth";
import { getDriverRoutes } from "@/lib/driver-data";
import { driverJson, driverPreflight } from "@/lib/driver-http";
import type { DriverRoutesResponse } from "@/lib/driver-api-types";

export const runtime = "nodejs";

export function OPTIONS() {
  return driverPreflight();
}

export async function GET(request: Request) {
  const driver = await requireDriver(request);
  if (!driver) {
    return driverJson({ error: "Not signed in." }, 401);
  }

  const routes = await getDriverRoutes(driver.vehicleId);
  const response: DriverRoutesResponse = { routes };
  return driverJson(response);
}
