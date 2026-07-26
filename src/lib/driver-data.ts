import { prisma } from "@/lib/prisma";
import type {
  DriverRoute,
  DriverSheetCustomer,
  DriverSheetProduct,
  DriverSheetResponse,
} from "@/lib/driver-api-types";

// Data layer for the driver mobile API. All queries run after requireDriver()
// has set the city context, so the Prisma city-isolation backstop scopes
// Route/Customer/Product automatically; we additionally pin routes to the
// token's vehicleId so a driver only ever sees their own vehicle's work.

function toMonthStart(dateInput: string): Date {
  const month = /^\d{4}-\d{2}-\d{2}$/.test(dateInput)
    ? dateInput.slice(0, 7)
    : new Date().toISOString().slice(0, 7);
  return new Date(`${month}-01T00:00:00.000Z`);
}

function toDay(dateInput: string): Date {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dateInput) ? dateInput : new Date().toISOString().slice(0, 10);
  return new Date(`${day}T00:00:00.000Z`);
}

// How far a new GPS fix must be from a customer's already-saved location
// before it's treated as a real move (vs. ordinary fix jitter) worth asking
// the driver about. Re-verified here in saveDriverLine — see there.
const LOCATION_DRIFT_THRESHOLD_METERS = 12;

// Great-circle distance between two lat/lng points, in meters. Duplicated in
// mobile/src/location.ts rather than imported: this project deliberately
// keeps Metro from reaching outside mobile/'s own directory for anything but
// type-only imports (see that file's header comment), and this is a ~10-line
// pure function — not worth the cross-project resolution risk to dedupe.
function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const EARTH_RADIUS_METERS = 6371000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// The vehicle's active routes (what the driver can run).
export async function getDriverRoutes(vehicleId: string): Promise<DriverRoute[]> {
  const routes = await prisma.route.findMany({
    where: { vehicleId, isActive: true },
    orderBy: [{ shift: "asc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, shift: true },
  });
  return routes.map((route) => ({
    id: route.id,
    code: route.code,
    name: route.name,
    shift: route.shift,
  }));
}

// How far back to look for a customer's most recent delivery when suggesting
// today's default quantity. Bounds the history query; well past a month
// covers a customer who's been skipped for a while (holiday, temporary stop).
const RECENT_ORDER_LOOKBACK_DAYS = 45;

// The delivery sheet for one route + date: the month's customer sequence in
// order, each with the same active product catalog the web Daily Entry screen
// uses (see src/lib/daily-entry.ts), pre-filled with what the customer most
// recently took (their "usual order" — there's no separately configured
// default anywhere in this app; RouteCustomerAssignment /
// RouteCustomerProductDefault exist in the schema but nothing writes to them),
// and any marks already saved for this date. Returns null when the route
// isn't this vehicle's (or doesn't exist).
export async function getDriverSheet(
  vehicleId: string,
  routeId: string,
  dateInput: string,
): Promise<DriverSheetResponse | null> {
  const sequenceMonth = toMonthStart(dateInput);
  const entryDate = toDay(dateInput);
  const recentSince = new Date(entryDate);
  recentSince.setUTCDate(recentSince.getUTCDate() - RECENT_ORDER_LOOKBACK_DAYS);

  const [route, products, recentEntries] = await Promise.all([
    prisma.route.findFirst({
      where: { id: routeId, vehicleId, isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        shift: true,
        monthlySequences: {
          where: { status: "ACTIVE", sequenceMonth },
          orderBy: { sequenceNo: "asc" },
          select: {
            customerId: true,
            sequenceNo: true,
            customer: { select: { name: true, area: true, mobile: true, latitude: true, longitude: true } },
          },
        },
        entries: {
          where: { entryDate },
          take: 1,
          select: {
            lines: {
              select: {
                customerId: true,
                skipped: true,
                remarks: true,
                productEntries: { select: { productId: true, quantity: true, rateSnapshot: true } },
              },
            },
          },
        },
      },
    }),
    prisma.product.findMany({
      where: { isActive: true, showInDailyEntry: true },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true, shortName: true, unit: true, defaultRate: true },
    }),
    // One bounded query for the whole route, not per customer: every prior
    // day's non-skipped lines, newest first, so we can pick each customer's
    // most recent delivery in a single pass below.
    prisma.dailyRouteEntry.findMany({
      where: { routeId, entryDate: { lt: entryDate, gte: recentSince } },
      orderBy: { entryDate: "desc" },
      select: {
        lines: {
          where: { skipped: false },
          select: { customerId: true, productEntries: { select: { productId: true, quantity: true } } },
        },
      },
    }),
  ]);

  if (!route) {
    return null;
  }

  const lineByCustomer = new Map((route.entries[0]?.lines ?? []).map((line) => [line.customerId, line]));

  // First non-empty delivery found per customer, walking newest-to-oldest —
  // that's their most recent "usual order".
  const recentOrderByCustomer = new Map<string, Map<string, number>>();
  for (const entry of recentEntries) {
    for (const line of entry.lines) {
      if (recentOrderByCustomer.has(line.customerId)) {
        continue;
      }
      const quantities = new Map<string, number>();
      line.productEntries.forEach((productEntry) => {
        const quantity = Number(productEntry.quantity);
        if (quantity > 0) {
          quantities.set(productEntry.productId, quantity);
        }
      });
      if (quantities.size > 0) {
        recentOrderByCustomer.set(line.customerId, quantities);
      }
    }
  }

  const customers: DriverSheetCustomer[] = route.monthlySequences.map((seq) => {
    const savedLine = lineByCustomer.get(seq.customerId);
    const savedProducts = new Map((savedLine?.productEntries ?? []).map((entry) => [entry.productId, entry]));
    const recentOrder = recentOrderByCustomer.get(seq.customerId);

    const sheetProducts: DriverSheetProduct[] = products.map((product) => {
      const saved = savedProducts.get(product.id);
      const recentQty = recentOrder?.get(product.id);
      const defaultQty = recentQty !== undefined ? String(recentQty) : "0";
      // Once there's a real line for today, it's authoritative — 0 if this
      // product isn't on it, never the recent-order suggestion. Without this,
      // a skipped (or partially-delivered) line would misreport the
      // suggested "usual order" as if it had actually been delivered.
      const deliveredQty = savedLine ? String(saved?.quantity ?? 0) : defaultQty;
      return {
        productId: product.id,
        code: product.code,
        shortName: product.shortName,
        unit: product.unit,
        rate: String(saved?.rateSnapshot ?? product.defaultRate),
        defaultQty,
        deliveredQty,
      };
    });

    return {
      customerId: seq.customerId,
      sequenceNo: seq.sequenceNo,
      name: seq.customer.name,
      area: seq.customer.area,
      mobile: seq.customer.mobile,
      products: sheetProducts,
      skipped: savedLine?.skipped ?? false,
      remarks: savedLine?.remarks ?? null,
      saved: Boolean(savedLine),
      latitude: seq.customer.latitude !== null ? String(seq.customer.latitude) : null,
      longitude: seq.customer.longitude !== null ? String(seq.customer.longitude) : null,
    };
  });

  return {
    route: { id: route.id, code: route.code, name: route.name, shift: route.shift },
    date: dateInput,
    customers,
  };
}

export type SaveDriverLineInput = {
  skipped: boolean;
  remarks?: string;
  products: Array<{ productId: string; quantity: number; rateSnapshot: number }>;
  location?: { latitude: number; longitude: number };
  // True only when the driver explicitly answered "yes" to the "update saved
  // location?" prompt shown after a >12m drift was detected client-side.
  // Re-verified server-side rather than trusted outright, since it overwrites
  // persisted customer data.
  confirmLocationUpdate?: boolean;
};

export type SaveDriverLineResult =
  | { ok: true; customer: DriverSheetCustomer }
  | { ok: false; error: string };

// Per-customer incremental save — writes just this one customer's line for the
// date (upsert the day's entry, upsert the line, replace its product rows),
// leaving every other customer on the route untouched. Refuses if this
// customer's bill for the month is already finalized (Generated/Locked).
export async function saveDriverLine(
  vehicleId: string,
  routeId: string,
  customerId: string,
  dateInput: string,
  input: SaveDriverLineInput,
): Promise<SaveDriverLineResult> {
  const sequenceMonth = toMonthStart(dateInput);
  const entryDate = toDay(dateInput);

  const route = await prisma.route.findFirst({
    where: { id: routeId, vehicleId, isActive: true },
    select: { id: true },
  });
  if (!route) {
    return { ok: false, error: "Route not found for this vehicle." };
  }

  const sequence = await prisma.monthlyRouteCustomerSequence.findUnique({
    where: { routeId_sequenceMonth_customerId: { routeId, sequenceMonth, customerId } },
    select: { sequenceNo: true },
  });
  if (!sequence) {
    return { ok: false, error: "Customer isn't on this route's sequence for the month." };
  }

  const frozenBill = await prisma.monthlyBill.findFirst({
    where: { routeId, customerId, billingMonth: sequenceMonth, status: { in: ["GENERATED", "LOCKED"] } },
    select: { status: true },
  });
  if (frozenBill) {
    return {
      ok: false,
      error: `This customer's bill is already ${frozenBill.status === "LOCKED" ? "locked" : "generated"} for the month — ask the office to reopen it before changing today's delivery.`,
    };
  }

  const productRows = input.skipped
    ? []
    : input.products
        .filter((product) => product.quantity > 0)
        .map((product) => ({ productId: product.productId, quantity: product.quantity, rateSnapshot: product.rateSnapshot }));

  await prisma.$transaction(async (tx) => {
    const entry = await tx.dailyRouteEntry.upsert({
      where: { routeId_entryDate: { routeId, entryDate } },
      update: {},
      create: { routeId, entryDate, syncStatus: "SYNCED" },
      select: { id: true },
    });

    const line = await tx.dailyRouteEntryLine.upsert({
      where: { entryId_customerId: { entryId: entry.id, customerId } },
      update: { sequenceNo: sequence.sequenceNo, skipped: input.skipped, remarks: input.remarks?.trim() || null },
      create: {
        entryId: entry.id,
        customerId,
        sequenceNo: sequence.sequenceNo,
        skipped: input.skipped,
        remarks: input.remarks?.trim() || null,
      },
      select: { id: true },
    });

    await tx.dailyRouteEntryLineProduct.deleteMany({ where: { lineId: line.id } });
    if (productRows.length > 0) {
      await tx.dailyRouteEntryLineProduct.createMany({
        data: productRows.map((row) => ({ lineId: line.id, ...row })),
      });
    }

    // Backfill the customer's location from their first delivery that
    // includes one. After that, a new fix only overwrites it if the driver
    // was prompted (client-side, comparing against the location it already
    // had) and said yes — never silently, since a single GPS fix is a
    // point-in-time reading, not necessarily more accurate than what's saved.
    // Skipped visits never carry a location; see DriverSaveLineRequest.location.
    if (!input.skipped && input.location) {
      const existing = await tx.customer.findUnique({
        where: { id: customerId },
        select: { latitude: true, longitude: true },
      });
      if (existing && existing.latitude === null && existing.longitude === null) {
        await tx.customer.update({
          where: { id: customerId },
          data: { latitude: input.location.latitude, longitude: input.location.longitude },
        });
      } else if (existing && input.confirmLocationUpdate) {
        // Re-check the drift ourselves rather than trusting the client's flag
        // at face value — it only means "the driver said yes to a prompt",
        // not "the distance genuinely warrants it".
        const distance = haversineDistanceMeters(
          Number(existing.latitude),
          Number(existing.longitude),
          input.location.latitude,
          input.location.longitude,
        );
        if (distance > LOCATION_DRIFT_THRESHOLD_METERS) {
          await tx.customer.update({
            where: { id: customerId },
            data: { latitude: input.location.latitude, longitude: input.location.longitude },
          });
        }
      }
    }
  });

  const sheet = await getDriverSheet(vehicleId, routeId, dateInput);
  const customer = sheet?.customers.find((entry) => entry.customerId === customerId);
  if (!customer) {
    return { ok: false, error: "Saved, but could not reload the customer." };
  }
  return { ok: true, customer };
}
