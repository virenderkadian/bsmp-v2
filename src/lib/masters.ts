import type { Product, Route, Vehicle, Customer } from "@prisma/client";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";

export type ProductRecord = Pick<
  Product,
  "id" | "code" | "name" | "shortName" | "unit" | "displayOrder" | "showInDailyEntry" | "isActive"
> & {
  defaultRate: string;
};
export type VehicleRecord = Pick<Vehicle, "id" | "code" | "name" | "registration" | "isActive">;
export type CustomerRecord = Pick<Customer, "id" | "code" | "name" | "area" | "mobile" | "isActive"> & {
  openingBalance: string;
  sequenceRouteId: string | null;
  sequenceRouteName: string | null;
  sequenceRouteShift: string | null;
  sequenceRouteMonth: string | null;
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
  customers: CustomerRecord[];
  error?: string;
};

function fallbackPayload(error?: string): MastersPayload {
  return {
    dbConnected: false,
    error,
    products: [],
    vehicles: [],
    routes: [],
    customers: [],
  };
}

export async function getMastersPayload(): Promise<MastersPayload> {
  try {
    const products = await withDbTimeout(prisma.product.findMany({
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
        isActive: true,
      },
    }), "Product master request");

    const vehicles = await withDbTimeout(prisma.vehicle.findMany({
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        registration: true,
        isActive: true,
      },
    }), "Vehicle master request");

    const routes = await withDbTimeout(prisma.route.findMany({
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

    const customers = await withDbTimeout(prisma.customer.findMany({
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        area: true,
        mobile: true,
        openingBalance: true,
        isActive: true,
        monthlySequences: {
          where: {
            status: "ACTIVE",
          },
          orderBy: [
            { sequenceMonth: "desc" },
            { sequenceNo: "asc" },
          ],
          take: 1,
          select: {
            routeId: true,
            sequenceMonth: true,
            route: {
              select: {
                name: true,
                shift: true,
              },
            },
          },
        },
      },
    }), "Customer master request");

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
      customers: customers.map((customer) => ({
        id: customer.id,
        code: customer.code,
        name: customer.name,
        area: customer.area,
        mobile: customer.mobile,
        isActive: customer.isActive,
        openingBalance: String(customer.openingBalance),
        sequenceRouteId: customer.monthlySequences[0]?.routeId ?? null,
        sequenceRouteName: customer.monthlySequences[0]?.route.name ?? null,
        sequenceRouteShift: customer.monthlySequences[0]?.route.shift ?? null,
        sequenceRouteMonth: customer.monthlySequences[0]?.sequenceMonth.toISOString().slice(0, 7) ?? null,
      })),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load master data.";

    return fallbackPayload(message);
  }
}
