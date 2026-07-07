import type {
  Customer,
  Product,
  Route,
  RouteCustomerAssignment,
  RouteCustomerProductDefault,
  RouteShift,
} from "@prisma/client";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";

export type AssignmentRouteRecord = Pick<Route, "id" | "code" | "name" | "shift"> & {
  vehicleName: string | null;
};

export type AssignmentCustomerRecord = Pick<Customer, "id" | "code" | "name" | "area">;
export type AssignmentProductRecord = Pick<Product, "id" | "code" | "name" | "unit">;

export type AssignmentDefaultRecord = Pick<
  RouteCustomerProductDefault,
  "id"
> & {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  defaultQty: string;
  defaultRate: string;
};

export type AssignmentRecord = Pick<
  RouteCustomerAssignment,
  "id" | "routeId" | "customerId" | "sequenceNo" | "status"
> & {
  routeCode: string;
  routeName: string;
  routeShift: RouteShift;
  vehicleName: string | null;
  customerCode: string;
  customerName: string;
  customerArea: string | null;
  defaults: AssignmentDefaultRecord[];
};

export type AssignmentsPayload = {
  dbConnected: boolean;
  routes: AssignmentRouteRecord[];
  customers: AssignmentCustomerRecord[];
  products: AssignmentProductRecord[];
  assignments: AssignmentRecord[];
  error?: string;
};

function fallbackPayload(error?: string): AssignmentsPayload {
  return {
    dbConnected: false,
    error,
    routes: [],
    customers: [],
    products: [],
    assignments: [],
  };
}

export async function getAssignmentsPayload(): Promise<AssignmentsPayload> {
  try {
    const [routes, customers, products, assignments] = await withDbTimeout(Promise.all([
      prisma.route.findMany({
        orderBy: [{ shift: "asc" }, { code: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          shift: true,
          vehicle: {
            select: {
              name: true,
            },
          },
        },
      }),
      prisma.customer.findMany({
        orderBy: { code: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          area: true,
        },
      }),
      prisma.product.findMany({
        where: { isActive: true },
        orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          unit: true,
        },
      }),
      prisma.routeCustomerAssignment.findMany({
        orderBy: [{ route: { code: "asc" } }, { sequenceNo: "asc" }],
        select: {
          id: true,
          routeId: true,
          customerId: true,
          sequenceNo: true,
          status: true,
          route: {
            select: {
              code: true,
              name: true,
              shift: true,
              vehicle: {
                select: {
                  name: true,
                },
              },
            },
          },
          customer: {
            select: {
              code: true,
              name: true,
              area: true,
            },
          },
          defaults: {
            orderBy: [{ product: { code: "asc" } }],
            select: {
              id: true,
              productId: true,
              defaultQty: true,
              defaultRate: true,
              product: {
                select: {
                  code: true,
                  name: true,
                  unit: true,
                },
              },
            },
          },
        },
      }),
    ]), "Assignment data request");

    return {
      dbConnected: true,
      routes: routes.map((route) => ({
        id: route.id,
        code: route.code,
        name: route.name,
        shift: route.shift,
        vehicleName: route.vehicle?.name ?? null,
      })),
      customers,
      products,
      assignments: assignments.map((assignment) => ({
        id: assignment.id,
        routeId: assignment.routeId,
        customerId: assignment.customerId,
        sequenceNo: assignment.sequenceNo,
        status: assignment.status,
        routeCode: assignment.route.code,
        routeName: assignment.route.name,
        routeShift: assignment.route.shift,
        vehicleName: assignment.route.vehicle?.name ?? null,
        customerCode: assignment.customer.code,
        customerName: assignment.customer.name,
        customerArea: assignment.customer.area,
        defaults: assignment.defaults.map((item) => ({
          id: item.id,
          productId: item.productId,
          defaultQty: String(item.defaultQty),
          defaultRate: String(item.defaultRate),
          productCode: item.product.code,
          productName: item.product.name,
          unit: item.product.unit,
        })),
      })),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load assignment data.";

    return fallbackPayload(message);
  }
}
