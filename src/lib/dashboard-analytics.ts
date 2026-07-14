import { getCurrentCityId } from "@/lib/current-city";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";

const MAX_RANGE_DAYS = 90;
const WOW_WINDOW_DAYS = 7;

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateInput: string, days: number) {
  const date = new Date(`${dateInput}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateInput(date);
}

function dayDiff(fromInput: string, toInput: string) {
  const from = new Date(`${fromInput}T00:00:00.000Z`);
  const to = new Date(`${toInput}T00:00:00.000Z`);
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

function enumerateDates(fromInput: string, toInput: string) {
  const dates: string[] = [];
  let cursor = fromInput;
  while (cursor <= toInput) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export type TrendPoint = { date: string; quantity: string };

export type VehicleSeries = {
  vehicleId: string;
  vehicleCode: string;
  vehicleName: string;
  points: TrendPoint[];
  totalQuantity: string;
  wowDeltaQuantity: string;
  wowDeltaPercent: string | null;
};

export type ProductContributionEntry = {
  productId: string;
  productName: string;
  unit: string;
  byVehicle: Array<{ vehicleId: string; vehicleName: string; quantity: string }>;
  totalQuantity: string;
};

export type AnalyticsPayload = {
  dbConnected: boolean;
  from: string;
  to: string;
  vehicles: Array<{ id: string; code: string; name: string }>;
  selectedVehicleId: string;
  compareVehicleId: string;
  trend: VehicleSeries | null;
  comparison: VehicleSeries | null;
  productContribution: ProductContributionEntry[];
  error?: string;
};

function fallbackPayload(from: string, to: string, error?: string): AnalyticsPayload {
  return {
    dbConnected: false,
    from,
    to,
    vehicles: [],
    selectedVehicleId: "",
    compareVehicleId: "",
    trend: null,
    comparison: null,
    productContribution: [],
    error,
  };
}

function buildSeries(
  vehicle: { id: string; code: string; name: string },
  dateRange: string[],
  qtyByDate: Map<string, number>,
  extendedQtyByDate: Map<string, number>,
  from: string,
  to: string,
): VehicleSeries {
  const points = dateRange.map((date) => ({ date, quantity: (qtyByDate.get(date) ?? 0).toFixed(3) }));
  const totalQuantity = points.reduce((sum, point) => sum + Number(point.quantity), 0);

  const lastWindowStart = addDays(to, -(WOW_WINDOW_DAYS - 1));
  const prevWindowEnd = addDays(lastWindowStart, -1);
  const prevWindowStart = addDays(prevWindowEnd, -(WOW_WINDOW_DAYS - 1));

  let lastWindowSum = 0;
  for (const date of enumerateDates(lastWindowStart, to)) {
    lastWindowSum += extendedQtyByDate.get(date) ?? 0;
  }
  let prevWindowSum = 0;
  for (const date of enumerateDates(prevWindowStart, prevWindowEnd)) {
    prevWindowSum += extendedQtyByDate.get(date) ?? 0;
  }

  const wowDeltaQuantity = lastWindowSum - prevWindowSum;
  const wowDeltaPercent = prevWindowSum > 0 ? ((wowDeltaQuantity / prevWindowSum) * 100).toFixed(1) : null;

  return {
    vehicleId: vehicle.id,
    vehicleCode: vehicle.code,
    vehicleName: vehicle.name,
    points,
    totalQuantity: totalQuantity.toFixed(3),
    wowDeltaQuantity: wowDeltaQuantity.toFixed(3),
    wowDeltaPercent,
  };
}

export async function getAnalyticsPayload(input?: {
  from?: string;
  to?: string;
  vehicleId?: string;
  compareVehicleId?: string;
}): Promise<AnalyticsPayload> {
  const today = toDateInput(new Date());
  let to = /^\d{4}-\d{2}-\d{2}$/.test(input?.to ?? "") ? (input!.to as string) : today;
  let from = /^\d{4}-\d{2}-\d{2}$/.test(input?.from ?? "") ? (input!.from as string) : addDays(to, -9);

  if (from > to) {
    [from, to] = [to, from];
  }
  if (dayDiff(from, to) > MAX_RANGE_DAYS) {
    from = addDays(to, -MAX_RANGE_DAYS);
  }

  // Fetched wider than [from, to] so week-over-week comparison has data even
  // when the visible range is short — only points inside [from, to] render
  // on the chart, but the extra week feeds the WoW delta.
  const queryFrom = addDays(from, -2 * WOW_WINDOW_DAYS);

  try {
    const cityId = await getCurrentCityId();

    const [vehicles, dailyEntryProducts, entries] = await withDbTimeout(
      Promise.all([
        prisma.vehicle.findMany({
          where: { cityId, isActive: true },
          orderBy: { code: "asc" },
          select: { id: true, code: true, name: true },
        }),
        prisma.product.findMany({
          where: { cityId, isActive: true, showInDailyEntry: true },
          orderBy: { displayOrder: "asc" },
          select: { id: true, name: true, unit: true },
        }),
        prisma.dailyRouteEntry.findMany({
          where: {
            route: { cityId, vehicleId: { not: null } },
            entryDate: { gte: new Date(queryFrom), lte: new Date(to) },
          },
          select: {
            entryDate: true,
            route: { select: { vehicleId: true } },
            lines: {
              select: {
                productEntries: { select: { productId: true, quantity: true } },
              },
            },
          },
        }),
      ]),
      "Dashboard analytics request",
      10_000,
    );

    if (vehicles.length === 0) {
      return { ...fallbackPayload(from, to), dbConnected: true, vehicles: [] };
    }

    const selectedVehicleId = vehicles.some((v) => v.id === input?.vehicleId) ? (input!.vehicleId as string) : vehicles[0].id;
    const compareVehicleId = vehicles.some((v) => v.id === input?.compareVehicleId)
      ? (input!.compareVehicleId as string)
      : (vehicles[1]?.id ?? vehicles[0].id);

    // qtyByVehicleDate[vehicleId] -> Map(date -> qty), for trend/comparison lines
    const qtyByVehicleDate = new Map<string, Map<string, number>>();
    // qtyByProductVehicle[productId] -> Map(vehicleId -> qty), summed over [from, to] only
    const qtyByProductVehicle = new Map<string, Map<string, number>>();

    for (const entry of entries) {
      const vehicleId = entry.route.vehicleId;
      if (!vehicleId) continue;
      const date = toDateInput(entry.entryDate);

      let vehicleDates = qtyByVehicleDate.get(vehicleId);
      if (!vehicleDates) {
        vehicleDates = new Map();
        qtyByVehicleDate.set(vehicleId, vehicleDates);
      }

      for (const line of entry.lines) {
        for (const productEntry of line.productEntries) {
          const qty = Number(productEntry.quantity);
          vehicleDates.set(date, (vehicleDates.get(date) ?? 0) + qty);

          if (date >= from && date <= to) {
            let productVehicles = qtyByProductVehicle.get(productEntry.productId);
            if (!productVehicles) {
              productVehicles = new Map();
              qtyByProductVehicle.set(productEntry.productId, productVehicles);
            }
            productVehicles.set(vehicleId, (productVehicles.get(vehicleId) ?? 0) + qty);
          }
        }
      }
    }

    const dateRange = enumerateDates(from, to);

    const buildForVehicle = (vehicleId: string) => {
      const vehicle = vehicles.find((v) => v.id === vehicleId);
      if (!vehicle) return null;
      const extended = qtyByVehicleDate.get(vehicleId) ?? new Map();
      return buildSeries(vehicle, dateRange, extended, extended, from, to);
    };

    const trend = buildForVehicle(selectedVehicleId);
    const comparison = compareVehicleId !== selectedVehicleId ? buildForVehicle(compareVehicleId) : null;

    const productContribution: ProductContributionEntry[] = dailyEntryProducts
      .map((product) => {
        const byVehicleMap = qtyByProductVehicle.get(product.id) ?? new Map<string, number>();
        const byVehicle = vehicles
          .map((vehicle) => ({
            vehicleId: vehicle.id,
            vehicleName: vehicle.name,
            quantity: (byVehicleMap.get(vehicle.id) ?? 0).toFixed(3),
          }))
          .filter((row) => Number(row.quantity) > 0);
        const totalQuantity = byVehicle.reduce((sum, row) => sum + Number(row.quantity), 0);

        return {
          productId: product.id,
          productName: product.name,
          unit: product.unit,
          byVehicle,
          totalQuantity: totalQuantity.toFixed(3),
        };
      })
      .filter((entry) => Number(entry.totalQuantity) > 0);

    return {
      dbConnected: true,
      from,
      to,
      vehicles,
      selectedVehicleId,
      compareVehicleId,
      trend,
      comparison,
      productContribution,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load analytics data.";

    return fallbackPayload(from, to, message);
  }
}
