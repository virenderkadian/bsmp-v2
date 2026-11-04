import { requireDriver } from "@/lib/driver-auth";
import { getDriverBillDetail } from "@/lib/driver-data";
import { driverJson, driverPreflight } from "@/lib/driver-http";
import type { DriverBillDetailResponse } from "@/lib/driver-api-types";

export const runtime = "nodejs";

export function OPTIONS() {
  return driverPreflight();
}

export async function GET(request: Request, context: { params: Promise<{ billId: string }> }) {
  const driver = await requireDriver(request);
  if (!driver) {
    return driverJson({ error: "Not signed in." }, 401);
  }

  const { billId } = await context.params;

  const result = await getDriverBillDetail(driver.vehicleId, driver.cityId, billId);
  if (!result.ok) {
    return driverJson({ error: result.error }, 404);
  }

  const response: DriverBillDetailResponse = result.bill;
  return driverJson(response);
}
