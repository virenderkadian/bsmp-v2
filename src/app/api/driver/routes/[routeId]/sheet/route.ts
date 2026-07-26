import { requireDriver } from "@/lib/driver-auth";
import { getDriverSheet } from "@/lib/driver-data";
import { driverJson, driverPreflight } from "@/lib/driver-http";

export const runtime = "nodejs";

export function OPTIONS() {
  return driverPreflight();
}

export async function GET(request: Request, context: { params: Promise<{ routeId: string }> }) {
  const driver = await requireDriver(request);
  if (!driver) {
    return driverJson({ error: "Not signed in." }, 401);
  }

  const { routeId } = await context.params;
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);

  const sheet = await getDriverSheet(driver.vehicleId, routeId, date);
  if (!sheet) {
    return driverJson({ error: "Route not found for this vehicle." }, 404);
  }

  return driverJson(sheet);
}
