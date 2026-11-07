import { requireDriver } from "@/lib/driver-auth";
import { getDriverRoutes } from "@/lib/driver-data";
import { driverJson, driverPreflight } from "@/lib/driver-http";
import type { DriverRoutesResponse } from "@/lib/driver-api-types";
import { stockWindow } from "@/lib/driver-stock-rules";

function previousDay(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export const runtime = "nodejs";

export function OPTIONS() {
  return driverPreflight();
}

export async function GET(request: Request) {
  const driver = await requireDriver(request);
  if (!driver) {
    return driverJson({ error: "Not signed in." }, 401);
  }

  const routes = await getDriverRoutes(driver.vehicleId, driver.cityId);
  const window = stockWindow();
  const response: DriverRoutesResponse = { routes, today: window.today, cycleDate: window.cycleDate, eveningDate: window.eveningDate,
    previousCycleDate: previousDay(window.cycleDate), previousEveningDate: previousDay(window.eveningDate) };
  return driverJson(response);
}
