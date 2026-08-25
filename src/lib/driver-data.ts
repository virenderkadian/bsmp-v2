import { prisma } from "@/lib/prisma";
import type {
  DriverRoute,
  DriverSheetCustomer,
  DriverSheetProduct,
  DriverSheetResponse,
} from "@/lib/driver-api-types";

// Data layer for the driver mobile API.
//
// Every query here scopes by cityId EXPLICITLY, from the driver token, rather
// than leaning on the Prisma city-isolation backstop in src/lib/prisma.ts.
// That backstop is a safety net, and it was silently not applying on this
// path in production: the product catalog came back with every city's
// products merged (a driver in one city saw the other city's items in their
// delivery sheet). Explicit scoping is what the rest of the app already does
// — see the note in prisma.ts that it "is a backstop, not the primary
// defense — every action file already scopes its own queries explicitly".
// Routes are additionally pinned to the token's vehicleId so a driver only
// ever sees their own vehicle's work.

function toMonthStart(dateInput: string): Date {
  const month = /^\d{4}-\d{2}-\d{2}$/.test(dateInput)
    ? dateInput.slice(0, 7)
    : new Date().toISOString().slice(0, 7);
  return new Date(`${month}-01T00:00:00.000Z`);
}

// Start of the month BEFORE the sheet's date. Derived from the requested date
// rather than "now", so opening yesterday's sheet still resolves the month that
// was previous *then*.
function toPreviousMonthStart(dateInput: string): Date {
  const monthStart = toMonthStart(dateInput);
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 1, 1));
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
export async function getDriverRoutes(vehicleId: string, cityId: string): Promise<DriverRoute[]> {
  const routes = await prisma.route.findMany({
    where: { cityId, vehicleId, isActive: true },
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
  cityId: string,
  routeId: string,
  dateInput: string,
): Promise<DriverSheetResponse | null> {
  const sequenceMonth = toMonthStart(dateInput);
  const entryDate = toDay(dateInput);
  const recentSince = new Date(entryDate);
  recentSince.setUTCDate(recentSince.getUTCDate() - RECENT_ORDER_LOOKBACK_DAYS);

  const previousMonth = toPreviousMonthStart(dateInput);

  // Order matters — must match the array below.
  const [route, products, profile, previousBills, recentEntries] = await Promise.all([
    prisma.route.findFirst({
      where: { id: routeId, cityId, vehicleId, isActive: true },
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
            customer: { select: { code: true, name: true, area: true, mobile: true, latitude: true, longitude: true } },
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
    // cityId is REQUIRED here, not optional hardening: without it this
    // returned every city's catalog merged together, so a driver saw
    // products that don't exist in their city (and could have delivered
    // against one, writing a cross-city row into billing).
    prisma.product.findMany({
      where: { cityId, isActive: true, showInDailyEntry: true },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, shortName: true, unit: true, defaultRate: true },
    }),
    // The city's UPI payee for the on-device payment QR. One row per city.
    prisma.businessProfile.findUnique({
      where: { cityId },
      select: { businessName: true, upiId: true },
    }),
    // Last month's ISSUED bills that still owe something. GENERATED only —
    // see previousBill on DriverSheetCustomer for why DRAFT and LOCKED are both
    // excluded. Explicitly city-scoped: MonthlyBill isn't covered by the Prisma
    // city guard.
    prisma.monthlyBill.findMany({
      where: {
        route: { cityId },
        billingMonth: previousMonth,
        status: "GENERATED",
        closingBalance: { gt: 0 },
      },
      select: { id: true, customerId: true, closingBalance: true },
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
  const previousBillByCustomer = new Map(previousBills.map((bill) => [bill.customerId, bill]));
  const previousMonthLabel = previousMonth.toISOString().slice(0, 7);

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
        name: product.name,
        shortName: product.shortName,
        unit: product.unit,
        rate: String(saved?.rateSnapshot ?? product.defaultRate),
        defaultQty,
        deliveredQty,
      };
    });

    return {
      customerId: seq.customerId,
      customerCode: seq.customer.code,
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
      previousBill: (() => {
        const bill = previousBillByCustomer.get(seq.customerId);
        return bill
          ? { billId: bill.id, month: previousMonthLabel, outstanding: String(bill.closingBalance) }
          : null;
      })(),
    };
  });

  return {
    route: { id: route.id, code: route.code, name: route.name, shift: route.shift },
    date: dateInput,
    customers,
    upi: profile?.upiId ? { upiId: profile.upiId, payeeName: profile.businessName } : null,
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
  cityId: string,
  routeId: string,
  customerId: string,
  dateInput: string,
  input: SaveDriverLineInput,
): Promise<SaveDriverLineResult> {
  const sequenceMonth = toMonthStart(dateInput);
  const entryDate = toDay(dateInput);

  const route = await prisma.route.findFirst({
    where: { id: routeId, cityId, vehicleId, isActive: true },
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

  // Scoped by CUSTOMER, not by route. A customer running two routes gets one
  // combined bill issued against whichever route is flagged billsHere, so
  // matching on routeId here would miss a frozen bill sitting on their OTHER
  // route — and let a delivery quietly change the data behind a bill that's
  // already been issued, which is the exact thing this guard exists to stop.
  const frozenBill = await prisma.monthlyBill.findFirst({
    where: {
      customerId,
      billingMonth: sequenceMonth,
      status: { in: ["GENERATED", "LOCKED"] },
      route: { cityId },
    },
    select: { status: true, route: { select: { code: true } } },
  });
  if (frozenBill) {
    return {
      ok: false,
      error: `This customer's bill for the month is already ${
        frozenBill.status === "LOCKED" ? "locked" : "generated"
      } on ${frozenBill.route.code} — ask the office to reopen it before changing today's delivery.`,
    };
  }

  const productRows = input.skipped
    ? []
    : input.products
        .filter((product) => product.quantity > 0)
        .map((product) => ({ productId: product.productId, quantity: product.quantity, rateSnapshot: product.rateSnapshot }));

  // Never trust the client's productIds: a phone still running the build that
  // listed every city's catalog (or an offline save queued from before this
  // fix) could post a product belonging to another city, which would land a
  // cross-city row in billing. Verified against this city's catalog here so a
  // stale client gets a clear rejection instead of silently corrupting data.
  if (productRows.length > 0) {
    const validProducts = await prisma.product.findMany({
      where: { cityId, id: { in: productRows.map((row) => row.productId) } },
      select: { id: true },
    });
    const validIds = new Set(validProducts.map((product) => product.id));
    const unknown = productRows.filter((row) => !validIds.has(row.productId));
    if (unknown.length > 0) {
      return {
        ok: false,
        error: "Some products aren't available in this city — please update the app and try again.",
      };
    }
  }

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

  const sheet = await getDriverSheet(vehicleId, cityId, routeId, dateInput);
  const customer = sheet?.customers.find((entry) => entry.customerId === customerId);
  if (!customer) {
    return { ok: false, error: "Saved, but could not reload the customer." };
  }
  return { ok: true, customer };
}

export type RecordDriverPaymentInput = {
  paymentId: string;
  customerId: string;
  amount: number;
  mode: "CASH" | "UPI";
  paidOn: string;
};

export type RecordDriverPaymentResult =
  | { ok: true; payment: { id: string; amount: string; mode: string; status: string; paidOn: string } }
  | { ok: false; error: string };

// Records money collected at the door.
//
// ALWAYS status PENDING. This is a driver's claim that they were handed money,
// not a confirmed receipt — the office verifies it afterwards. That distinction
// is load-bearing rather than cosmetic: getCityCustomerLedger counts only
// VERIFIED payments, so a driver-entered payment must not reduce anyone's
// outstanding balance until someone in the office confirms it.
//
// Idempotent on the client-supplied id, so an offline replay or a double tap
// cannot record the same money twice.
export async function recordDriverPayment(
  vehicleId: string,
  cityId: string,
  routeId: string,
  input: RecordDriverPaymentInput,
): Promise<RecordDriverPaymentResult> {
  const route = await prisma.route.findFirst({
    where: { id: routeId, cityId, vehicleId, isActive: true },
    select: { id: true },
  });
  if (!route) {
    return { ok: false, error: "Route not found for this vehicle." };
  }

  // The customer must belong to this city — a driver can only collect from
  // people they actually serve.
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, cityId },
    select: { id: true, code: true },
  });
  if (!customer) {
    return { ok: false, error: "Customer not found." };
  }

  if (!(input.amount > 0)) {
    return { ok: false, error: "Enter an amount greater than zero." };
  }

  const paidOn = toDay(input.paidOn);

  const payment = await prisma.payment.upsert({
    where: { id: input.paymentId },
    // Empty on purpose: a retry must not be able to change an amount or a mode
    // after the fact, only confirm the row already exists.
    update: {},
    create: {
      id: input.paymentId,
      customerId: customer.id,
      routeId,
      amount: input.amount,
      paymentDate: paidOn,
      mode: input.mode,
      status: "PENDING",
      notes: `${customer.code} paid the bill (collected by driver)`,
    },
    select: { id: true, amount: true, mode: true, status: true, paymentDate: true },
  });

  return {
    ok: true,
    payment: {
      id: payment.id,
      amount: String(payment.amount),
      mode: String(payment.mode),
      status: String(payment.status),
      paidOn: payment.paymentDate.toISOString().slice(0, 10),
    },
  };
}

export type UpdateDriverCustomerResult =
  | { ok: true; customer: { customerId: string; mobile: string | null } }
  | { ok: false; error: string };

// Drivers are the ones who discover a wrong or missing phone number, so they
// can correct it at the door. City-scoped like everything else here, and it
// only ever touches `mobile` — no other customer field is reachable from a
// driver-authenticated request.
export async function updateDriverCustomerMobile(
  cityId: string,
  customerId: string,
  mobile: string | null,
): Promise<UpdateDriverCustomerResult> {
  const existing = await prisma.customer.findFirst({
    where: { id: customerId, cityId },
    select: { id: true, mobile: true },
  });
  if (!existing) {
    return { ok: false, error: "Customer not found." };
  }

  const next = mobile?.trim() ? mobile.trim() : null;

  const updated = await prisma.customer.update({
    where: { id: existing.id },
    data: { mobile: next },
    select: { id: true, mobile: true },
  });

  return { ok: true, customer: { customerId: updated.id, mobile: updated.mobile } };
}
