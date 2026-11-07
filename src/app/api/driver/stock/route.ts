import { z } from "zod";
import { requireDriver } from "@/lib/driver-auth";
import { driverJson, driverPreflight } from "@/lib/driver-http";
import { getDriverStock, saveDriverStock, StockError } from "@/lib/driver-stock";

export const runtime = "nodejs";
export function OPTIONS() { return driverPreflight(); }
export async function GET(request: Request) {
  const driver = await requireDriver(request);
  if (!driver) return driverJson({ error: "Not signed in." }, 401);
  const cycleDate = new URL(request.url).searchParams.get("cycleDate") ?? undefined;
  try { return driverJson(await getDriverStock(driver.vehicleId, driver.cityId, cycleDate)); }
  catch (error) {
    if (error instanceof StockError) return driverJson({ error: error.message }, error.status);
    console.error("Driver stock read failed", error);
    return driverJson({ error: "Could not load stock. Please try again." }, 500);
  }
}
const schema = z.object({ requestId: z.uuid(), cycleDate: z.string(), productId: z.uuid(),
  action: z.enum(["EVENING_TAKEN", "EVENING_REFILL", "EVENING_RETURN", "MORNING_REFILL", "MORNING_RETURN"]), quantity: z.string() });
export async function POST(request: Request) {
  const driver = await requireDriver(request);
  if (!driver) return driverJson({ error: "Not signed in." }, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return driverJson({ error: "Invalid stock request." }, 400);
  try { return driverJson(await saveDriverStock(driver.vehicleId, driver.cityId, parsed.data)); }
  catch (error) {
    if (error instanceof StockError) return driverJson({ error: error.message }, error.status);
    console.error("Driver stock save failed", error);
    return driverJson({ error: "Could not save stock. Please try again." }, 500);
  }
}
