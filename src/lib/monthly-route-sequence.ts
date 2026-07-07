import { Prisma, type RouteAssignmentStatus, type RouteShift } from "@prisma/client";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";

export type MonthlySequenceRouteOption = {
  id: string;
  code: string;
  name: string;
  shift: RouteShift;
  vehicleName: string | null;
};

export type MonthlySequenceCustomerOption = {
  id: string;
  code: string;
  name: string;
  area: string | null;
  mobile: string | null;
};

export type MonthlySequenceLineRecord = {
  id: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  customerArea: string | null;
  customerMobile: string | null;
  sequenceNo: number;
  status: RouteAssignmentStatus;
};

export type MonthlyRouteSequencePayload = {
  dbConnected: boolean;
  routes: MonthlySequenceRouteOption[];
  customers: MonthlySequenceCustomerOption[];
  lines: MonthlySequenceLineRecord[];
  selectedRouteId: string;
  selectedMonth: string;
  routeLabel: string;
  error?: string;
};

function toMonthInput(date: Date) {
  return date.toISOString().slice(0, 7);
}

export function monthInputToDate(month: string) {
  const normalized = /^\d{4}-\d{2}$/.test(month) ? month : toMonthInput(new Date());
  return new Date(`${normalized}-01T00:00:00.000Z`);
}

function fallbackPayload(month?: string, error?: string): MonthlyRouteSequencePayload {
  return {
    dbConnected: false,
    routes: [],
    customers: [],
    lines: [],
    selectedRouteId: "",
    selectedMonth: month ?? toMonthInput(new Date()),
    routeLabel: "No route selected",
    error,
  };
}

function getMonthlySequenceErrorMessage(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2021" || error.code === "P2022") {
      return "Monthly sequence table is not ready. Run prisma migration, then reload this page.";
    }
  }

  const message =
    error instanceof Error ? error.message : "Unable to load monthly route sequence.";

  if (
    message.includes("findMany") ||
    message.includes("monthlyRouteCustomerSequence") ||
    message.includes("MonthlyRouteCustomerSequence")
  ) {
    return "Monthly sequence model is not ready in the running server. Run prisma generate/migration, then restart dev server.";
  }

  return message;
}

export async function getMonthlyRouteSequencePayload(input?: {
  routeId?: string;
  month?: string;
}): Promise<MonthlyRouteSequencePayload> {
  const selectedMonth = input?.month && /^\d{4}-\d{2}$/.test(input.month)
    ? input.month
    : toMonthInput(new Date());
  const sequenceMonth = monthInputToDate(selectedMonth);

  try {
    const [routes, customers] = await withDbTimeout(Promise.all([
      prisma.route.findMany({
        where: { isActive: true },
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
        where: { isActive: true },
        orderBy: { code: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          area: true,
          mobile: true,
        },
      }),
    ]), "Monthly route sequence options request");

    const routeOptions = routes.map((route) => ({
      id: route.id,
      code: route.code,
      name: route.name,
      shift: route.shift,
      vehicleName: route.vehicle?.name ?? null,
    }));

    const selectedRouteId =
      input?.routeId && routes.some((route) => route.id === input.routeId)
        ? input.routeId
        : routes[0]?.id ?? "";
    const selectedRoute = routes.find((route) => route.id === selectedRouteId);

    if (!selectedRouteId) {
      return {
        ...fallbackPayload(selectedMonth),
        dbConnected: true,
        routes: routeOptions,
        customers,
      };
    }

    try {
      const lines = await withDbTimeout(prisma.monthlyRouteCustomerSequence.findMany({
        where: {
          routeId: selectedRouteId,
          sequenceMonth,
        },
        orderBy: { sequenceNo: "asc" },
        select: {
          id: true,
          customerId: true,
          sequenceNo: true,
          status: true,
          customer: {
            select: {
              code: true,
              name: true,
              area: true,
              mobile: true,
            },
          },
        },
      }), "Monthly route sequence request");

      return {
        dbConnected: true,
        routes: routeOptions,
        customers,
        lines: lines.map((line) => ({
          id: line.id,
          customerId: line.customerId,
          customerCode: line.customer.code,
          customerName: line.customer.name,
          customerArea: line.customer.area,
          customerMobile: line.customer.mobile,
          sequenceNo: line.sequenceNo,
          status: line.status,
        })),
        selectedRouteId,
        selectedMonth,
        routeLabel: selectedRoute ? `${selectedRoute.code} - ${selectedRoute.name}` : "No route selected",
      };
    } catch (error) {
      return {
        dbConnected: true,
        routes: routeOptions,
        customers,
        lines: [],
        selectedRouteId,
        selectedMonth,
        routeLabel: selectedRoute ? `${selectedRoute.code} - ${selectedRoute.name}` : "No route selected",
        error: getMonthlySequenceErrorMessage(error),
      };
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load monthly route sequence.";

    return fallbackPayload(selectedMonth, message);
  }
}
