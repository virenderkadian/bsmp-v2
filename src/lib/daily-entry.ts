import type { EntrySyncStatus, RouteShift } from "@prisma/client";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";

export type DailyEntryRouteOption = {
  id: string;
  code: string;
  name: string;
  shift: RouteShift;
  vehicleName: string | null;
};

export type DailyEntryProductRecord = {
  productId: string;
  productCode: string;
  productName: string;
  productShortName: string | null;
  unit: string;
  quantity: string;
  defaultRate: string;
};

export type DailyEntryLineRecord = {
  customerId: string;
  customerCode: string;
  customerName: string;
  customerArea: string | null;
  sequenceNo: number;
  skipped: boolean;
  remarks: string;
  products: DailyEntryProductRecord[];
};

export type DailyEntryPayload = {
  dbConnected: boolean;
  routes: DailyEntryRouteOption[];
  selectedRouteId: string;
  selectedDate: string;
  routeLabel: string;
  shiftLabel: string;
  vehicleLabel: string;
  syncStatus: EntrySyncStatus;
  notes: string;
  lines: DailyEntryLineRecord[];
  error?: string;
};

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function toMonthStartDate(dateInput: string) {
  const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateInput)
    ? dateInput
    : toDateInput(new Date());
  const month = normalizedDate.slice(0, 7);

  return new Date(`${month}-01T00:00:00.000Z`);
}

function fallbackPayload(selectedDate?: string, error?: string): DailyEntryPayload {
  const date = selectedDate ?? toDateInput(new Date());

  return {
    dbConnected: false,
    selectedRouteId: "",
    selectedDate: date,
    routeLabel: "No route selected",
    shiftLabel: "-",
    vehicleLabel: "-",
    syncStatus: "DRAFT",
    notes: "",
    error,
    routes: [],
    lines: [],
  };
}

export async function getDailyEntryPayload(input?: {
  routeId?: string;
  entryDate?: string;
}): Promise<DailyEntryPayload> {
  const selectedDate = input?.entryDate ?? toDateInput(new Date());

  try {
    const sequenceMonth = toMonthStartDate(selectedDate);
    const routes = await withDbTimeout(prisma.route.findMany({
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
    }), "Daily entry route request");

    const products = await withDbTimeout(prisma.product.findMany({
      where: {
        isActive: true,
        showInDailyEntry: true,
      },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        shortName: true,
        unit: true,
        defaultRate: true,
      },
    }), "Daily entry product request");

    if (routes.length === 0) {
      return {
        dbConnected: true,
        routes: [],
        selectedRouteId: "",
        selectedDate,
        routeLabel: "No route selected",
        shiftLabel: "-",
        vehicleLabel: "-",
        syncStatus: "DRAFT",
        notes: "",
        lines: [],
      };
    }

    const selectedRouteId =
      input?.routeId && routes.some((route) => route.id === input.routeId)
        ? input.routeId
        : routes[0].id;

    const routePacket = await withDbTimeout(prisma.route.findUnique({
      where: { id: selectedRouteId },
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
        monthlySequences: {
          where: {
            status: "ACTIVE",
            sequenceMonth,
          },
          orderBy: { sequenceNo: "asc" },
          select: {
            customerId: true,
            sequenceNo: true,
            customer: {
              select: {
                code: true,
                name: true,
                area: true,
              },
            },
          },
        },
        entries: {
          where: {
            entryDate: new Date(selectedDate),
          },
          select: {
            id: true,
            syncStatus: true,
            notes: true,
            lines: {
              orderBy: { sequenceNo: "asc" },
              select: {
                customerId: true,
                sequenceNo: true,
                skipped: true,
                remarks: true,
                productEntries: {
                  select: {
                    productId: true,
                    quantity: true,
                    rateSnapshot: true,
                  },
                },
              },
            },
          },
          take: 1,
        },
      },
    }), "Daily entry route packet request");

    if (!routePacket) {
      return fallbackPayload(selectedDate, "Unable to load selected route.");
    }

    const existingEntry = routePacket.entries[0];
    const lineByCustomer = new Map(
      existingEntry?.lines.map((line) => [line.customerId, line]) ?? [],
    );

    return {
      dbConnected: true,
      selectedRouteId: routePacket.id,
      selectedDate,
      routeLabel: `${routePacket.code} - ${routePacket.name}`,
      shiftLabel: routePacket.shift === "MORNING" ? "Morning" : "Evening",
      vehicleLabel: routePacket.vehicle?.name ?? "Unassigned",
      syncStatus: existingEntry?.syncStatus ?? "DRAFT",
      notes: existingEntry?.notes ?? "",
      routes: routes.map((route) => ({
        id: route.id,
        code: route.code,
        name: route.name,
        shift: route.shift,
        vehicleName: route.vehicle?.name ?? null,
      })),
      lines: routePacket.monthlySequences.map((sequenceLine) => {
        const savedLine = lineByCustomer.get(sequenceLine.customerId);
        const savedProducts = new Map(
          savedLine?.productEntries.map((item) => [item.productId, item]) ?? [],
        );

        return {
          customerId: sequenceLine.customerId,
          customerCode: sequenceLine.customer.code,
          customerName: sequenceLine.customer.name,
          customerArea: sequenceLine.customer.area,
          sequenceNo: savedLine?.sequenceNo ?? sequenceLine.sequenceNo,
          skipped: savedLine?.skipped ?? false,
          remarks: savedLine?.remarks ?? "",
          products: products.map((product) => {
            const saved = savedProducts.get(product.id);

            return {
              productId: product.id,
              productCode: product.code,
              productName: product.name,
              productShortName: product.shortName,
              unit: product.unit,
              quantity: String(saved?.quantity ?? 0),
              defaultRate: String(saved?.rateSnapshot ?? product.defaultRate),
            };
          }),
        };
      }),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load daily entry data.";

    return fallbackPayload(selectedDate, message);
  }
}
