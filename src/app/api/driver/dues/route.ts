import { requireDriver } from "@/lib/driver-auth";
import { getDriverDues } from "@/lib/driver-data";
import { driverJson, driverPreflight } from "@/lib/driver-http";
import type { DriverDuesResponse } from "@/lib/driver-api-types";

export const runtime = "nodejs";

export function OPTIONS() {
  return driverPreflight();
}

export async function GET(request: Request) {
  const driver = await requireDriver(request);
  if (!driver) {
    return driverJson({ error: "Not signed in." }, 401);
  }

  const dues = await getDriverDues(driver.vehicleId, driver.cityId);
  const response: DriverDuesResponse = dues;
  return driverJson(response);
}
