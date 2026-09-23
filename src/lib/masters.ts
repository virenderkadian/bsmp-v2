import { Prisma } from "@prisma/client";
import type { Product, Route, Vehicle, Customer } from "@prisma/client";
import { getCurrentCityId } from "@/lib/current-city";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";
import { monthInputToDate } from "@/lib/monthly-route-sequence";

export type ProductRecord = Pick<
  Product,
  | "id"
  | "code"
  | "name"
  | "shortName"
  | "unit"
  | "displayOrder"
  | "showInDailyEntry"
  | "includeInReconciliation"
  | "isActive"
> & {
  defaultRate: string;
};
export type VehicleRecord = Pick<Vehicle, "id" | "code" | "name" | "registration" | "upiId" | "isActive"> & {
  // Whether a driver mobile-app PIN has been set (derived from pinUpdatedAt —
  // the hash itself is never sent to the client).
  hasPin: boolean;
};
export type CustomerRouteInfo = {
  routeId: string;
  routeName: string;
  routeShift: string;
  billsHere: boolean;
};
export type CustomerRecord = Pick<Customer, "id" | "code" | "name" | "area" | "mobile" | "isActive"> & {
  openingBalance: string;
  // The month these routes are drawn from: the current month if the customer
  // has an active sequence now, otherwise their last active month before that
  // (isCurrentMonth tells which). Null if they've never had one.
  sequenceMonth: string | null;
  isCurrentMonth: boolean;
  routes: CustomerRouteInfo[];
};
export type RouteRecord = Pick<
  Route,
  "id" | "code" | "name" | "shift" | "isActive" | "vehicleId" | "driverName" | "driverPhone"
> & {
  vehicleName: string | null;
};

export type MastersPayload = {
  dbConnected: boolean;
  products: ProductRecord[];
  vehicles: VehicleRecord[];
  routes: RouteRecord[];
  error?: string;
};

function fallbackPayload(error?: string): MastersPayload {
  return {
    dbConnected: false,
    error,
    products: [],
    vehicles: [],
    routes: [],
  };
}

export async function getMastersPayload(): Promise<MastersPayload> {
  try {
    const cityId = await getCurrentCityId();
    const products = await withDbTimeout(prisma.product.findMany({
      where: { cityId },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        shortName: true,
        unit: true,
        defaultRate: true,
        displayOrder: true,
        showInDailyEntry: true,
        includeInReconciliation: true,
        isActive: true,
      },
    }), "Product master request");

    const vehicleRows = await withDbTimeout(prisma.vehicle.findMany({
      where: { cityId },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        registration: true,
        isActive: true,
        pinUpdatedAt: true,
        upiId: true,
      },
    }), "Vehicle master request");
    const vehicles: VehicleRecord[] = vehicleRows.map((vehicle) => ({
      id: vehicle.id,
      code: vehicle.code,
      name: vehicle.name,
      registration: vehicle.registration,
      upiId: vehicle.upiId,
      isActive: vehicle.isActive,
      hasPin: vehicle.pinUpdatedAt != null,
    }));

    const routes = await withDbTimeout(prisma.route.findMany({
      where: { cityId },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        shift: true,
        vehicleId: true,
        driverName: true,
        driverPhone: true,
        isActive: true,
        vehicle: {
          select: {
            name: true,
          },
        },
      },
    }), "Route master request");

    return {
      dbConnected: true,
      products: products.map((product) => ({
        ...product,
        defaultRate: String(product.defaultRate),
      })),
      vehicles,
      routes: routes.map((route) => ({
        id: route.id,
        code: route.code,
        name: route.name,
        shift: route.shift,
        vehicleId: route.vehicleId,
        driverName: route.driverName,
        driverPhone: route.driverPhone,
        vehicleName: route.vehicle?.name ?? null,
        isActive: route.isActive,
      })),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load master data.";

    return fallbackPayload(message);
  }
}

// A customer's route(s) for display: their active route(s) this month if
// any (a customer can run more than one, e.g. morning + evening, with
// billsHere marking which one carries their bill), otherwise their most
// recent earlier active month. Scoped to a bounded set of customer ids —
// the current page of results, not the whole city — so this stays cheap
// regardless of how many customers exist.
async function resolveCustomerRoutes(
  cityId: string,
  customerIds: string[],
): Promise<Map<string, { sequenceMonth: string; isCurrentMonth: boolean; routes: CustomerRouteInfo[] }>> {
  const result = new Map<string, { sequenceMonth: string; isCurrentMonth: boolean; routes: CustomerRouteInfo[] }>();

  if (customerIds.length === 0) {
    return result;
  }

  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const currentMonthDate = monthInputToDate(currentMonthKey);

  // Current-month and fallback (last-active-month) rows are fetched together
  // instead of the fallback only running for whoever's missing from the
  // first result — each network round trip to the DB costs 150-500ms here,
  // so trading a little wasted Postgres work (both queries stay bounded to
  // this page's ≤50 ids) for one fewer round trip is a clear win.
  const [currentMonthRows, fallbackRows] = await withDbTimeout(
    Promise.all([
      prisma.monthlyRouteCustomerSequence.findMany({
        where: {
          customerId: { in: customerIds },
          customer: { cityId },
          status: "ACTIVE",
          sequenceMonth: currentMonthDate,
        },
        select: {
          customerId: true,
          routeId: true,
          billsHere: true,
          route: { select: { name: true, shift: true } },
        },
      }),
      // Latest ACTIVE month before this one, per customer — a raw query
      // since Prisma can't express "latest per customer" as a single
      // relation query.
      prisma.$queryRaw<
        Array<{
          customerId: string;
          routeId: string;
          billsHere: boolean;
          sequenceMonth: Date;
          routeName: string;
          routeShift: string;
        }>
      >`
        WITH latest AS (
          SELECT DISTINCT ON (s."customerId") s."customerId", s."sequenceMonth"
          FROM "MonthlyRouteCustomerSequence" s
          WHERE s."customerId"::text IN (${Prisma.join(customerIds)})
            AND s.status = 'ACTIVE'
            AND s."sequenceMonth" < ${currentMonthDate}
          ORDER BY s."customerId", s."sequenceMonth" DESC
        )
        SELECT s."customerId" AS "customerId", s."routeId" AS "routeId", s."billsHere" AS "billsHere",
          s."sequenceMonth" AS "sequenceMonth", r.name AS "routeName", r.shift::text AS "routeShift"
        FROM "MonthlyRouteCustomerSequence" s
        JOIN latest l ON l."customerId" = s."customerId" AND l."sequenceMonth" = s."sequenceMonth"
        JOIN "Route" r ON r.id = s."routeId"
        WHERE s.status = 'ACTIVE' AND r."cityId" = ${cityId}::uuid
      `,
    ]),
    "Customer routes request",
  );

  const currentByCustomer = new Map<string, CustomerRouteInfo[]>();
  for (const row of currentMonthRows) {
    const list = currentByCustomer.get(row.customerId) ?? [];
    list.push({
      routeId: row.routeId,
      routeName: row.route.name,
      routeShift: String(row.route.shift),
      billsHere: row.billsHere,
    });
    currentByCustomer.set(row.customerId, list);
  }

  for (const [customerId, routes] of currentByCustomer) {
    result.set(customerId, { sequenceMonth: currentMonthKey, isCurrentMonth: true, routes });
  }

  const fallbackByCustomer = new Map<string, { month: string; routes: CustomerRouteInfo[] }>();
  for (const row of fallbackRows) {
    const entry = fallbackByCustomer.get(row.customerId) ?? {
      month: row.sequenceMonth.toISOString().slice(0, 7),
      routes: [],
    };
    entry.routes.push({
      routeId: row.routeId,
      routeName: row.routeName,
      routeShift: row.routeShift,
      billsHere: row.billsHere,
    });
    fallbackByCustomer.set(row.customerId, entry);
  }

  // Only applied where there was no current-month row — computed for every
  // page customer above, but current-month data always wins where both exist.
  for (const [customerId, entry] of fallbackByCustomer) {
    if (!currentByCustomer.has(customerId)) {
      result.set(customerId, { sequenceMonth: entry.month, isCurrentMonth: false, routes: entry.routes });
    }
  }

  return result;
}

export type CustomersPayload = {
  dbConnected: boolean;
  customers: CustomerRecord[];
  total: number;
  page: number;
  pageSize: number;
  routeOptions: Array<{ id: string; name: string }>;
  error?: string;
};

const CUSTOMERS_PAGE_SIZE = 50;

function fallbackCustomersPayload(page: number, error?: string): CustomersPayload {
  return {
    dbConnected: false,
    customers: [],
    total: 0,
    page,
    pageSize: CUSTOMERS_PAGE_SIZE,
    routeOptions: [],
    error,
  };
}

// Search, route/status filters, and pagination all run in the database, so
// a visit only ever pulls the rows actually shown (or matched) — not the
// whole customer list, which is what made this page's cost grow with the
// customer count instead of staying flat. See CustomerScreen for the
// debounced search input driving this via URL params.
export async function getCustomersPayload(input?: {
  search?: string;
  routeId?: string;
  status?: string;
  page?: number;
}): Promise<CustomersPayload> {
  const page = input?.page && input.page > 0 ? Math.floor(input.page) : 1;
  const search = input?.search?.trim() ?? "";
  const routeId = input?.routeId ?? "";
  const status = input?.status ?? "";

  try {
    const cityId = await getCurrentCityId();
    const currentMonthDate = monthInputToDate(new Date().toISOString().slice(0, 7));

    // Fired now, awaited later — it doesn't depend on anything below and
    // nothing below depends on it, so it runs concurrently with the rest of
    // this function instead of adding its own round trip to the critical path.
    const routeOptionsPromise = withDbTimeout(prisma.route.findMany({
      where: { cityId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }), "Customer route filter options request");

    // Route filter matches a customer's CURRENT-month active route(s) only —
    // not the last-active fallback shown for display, which would need the
    // same city-wide latest-month scan this page exists to avoid.
    let routeCustomerIds: string[] | null = null;
    if (routeId) {
      const rows = await withDbTimeout(prisma.monthlyRouteCustomerSequence.findMany({
        where: { routeId, sequenceMonth: currentMonthDate, status: "ACTIVE", customer: { cityId } },
        select: { customerId: true },
      }), "Customer route filter request");
      routeCustomerIds = rows.map((row) => row.customerId);
    }

    const where: Prisma.CustomerWhereInput = {
      cityId,
      ...(status === "ACTIVE" ? { isActive: true } : {}),
      ...(status === "INACTIVE" ? { isActive: false } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
              { area: { contains: search, mode: "insensitive" } },
              { mobile: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(routeCustomerIds ? { id: { in: routeCustomerIds } } : {}),
    };

    const [total, customers] = await withDbTimeout(
      Promise.all([
        prisma.customer.count({ where }),
        prisma.customer.findMany({
          where,
          orderBy: { code: "asc" },
          skip: (page - 1) * CUSTOMERS_PAGE_SIZE,
          take: CUSTOMERS_PAGE_SIZE,
          select: {
            id: true,
            code: true,
            name: true,
            area: true,
            mobile: true,
            openingBalance: true,
            isActive: true,
          },
        }),
      ]),
      "Customer list request",
    );

    const routesByCustomer = await resolveCustomerRoutes(cityId, customers.map((customer) => customer.id));
    const routeOptionRows = await routeOptionsPromise;

    return {
      dbConnected: true,
      customers: customers.map((customer) => {
        const resolved = routesByCustomer.get(customer.id);

        return {
          id: customer.id,
          code: customer.code,
          name: customer.name,
          area: customer.area,
          mobile: customer.mobile,
          isActive: customer.isActive,
          openingBalance: String(customer.openingBalance),
          sequenceMonth: resolved?.sequenceMonth ?? null,
          isCurrentMonth: resolved?.isCurrentMonth ?? false,
          routes: resolved?.routes ?? [],
        };
      }),
      total,
      page,
      pageSize: CUSTOMERS_PAGE_SIZE,
      routeOptions: routeOptionRows,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load customers.";

    return fallbackCustomersPayload(page, message);
  }
}
