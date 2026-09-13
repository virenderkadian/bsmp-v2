import type { EntrySyncStatus, RouteShift } from "@prisma/client";
import { getCurrentCityId } from "@/lib/current-city";
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
  // What this customer most recently took on this route (within 45 days), so
  // the screen can show their usual order while entering. "0" when there's no
  // recent delivery to go on.
  lastQuantity: string;
};

// An occasional sale already recorded against this customer today — a kilo of
// paneer, a one-off ghee order. Kept separate from `products` because those are
// the grid's columns: these appear only on the customer who bought them.
//
// They MUST round-trip through the screen. A save rebuilds every line's product
// rows from what was posted, so an item the screen doesn't send back is
// silently deleted by the next save of that round.
export type DailyEntryExtraItem = {
  productId: string;
  productCode: string;
  productName: string;
  productShortName: string | null;
  unit: string;
  quantity: string;
  rate: string;
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
  extraItems: DailyEntryExtraItem[];
};

// Products that are not on the grid, offered when adding an occasional item.
export type DailyEntryOccasionalProduct = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  unit: string;
  defaultRate: string;
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
  occasionalProducts: DailyEntryOccasionalProduct[];
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
    occasionalProducts: [],
  };
}

export async function getDailyEntryPayload(input?: {
  routeId?: string;
  entryDate?: string;
}): Promise<DailyEntryPayload> {
  const selectedDate = input?.entryDate ?? toDateInput(new Date());

  try {
    const sequenceMonth = toMonthStartDate(selectedDate);
    const cityId = await getCurrentCityId();
    const routes = await withDbTimeout(prisma.route.findMany({
      where: { cityId, isActive: true },
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

    // Every active product, not just the grid's: the ones switched off still
    // need to be offered when adding an occasional item, and a saved one has
    // to be readable to round-trip through a save.
    const allProducts = await withDbTimeout(prisma.product.findMany({
      where: {
        cityId,
        isActive: true,
      },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        shortName: true,
        unit: true,
        defaultRate: true,
        showInDailyEntry: true,
      },
    }), "Daily entry product request");

    const products = allProducts.filter((product) => product.showInDailyEntry);
    const occasionalProducts: DailyEntryOccasionalProduct[] = allProducts
      .filter((product) => !product.showInDailyEntry)
      .map((product) => ({
        id: product.id,
        code: product.code,
        name: product.name,
        shortName: product.shortName,
        unit: product.unit,
        defaultRate: String(product.defaultRate),
      }));
    const productById = new Map(allProducts.map((product) => [product.id, product]));

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
        occasionalProducts: [],
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

    // What each customer most recently took ON THIS ROUTE, so the operator can
    // see their usual order while typing instead of recalling it. Bounded to a
    // 45-day window (same as the driver app) so a customer who's been away for
    // a while still shows something, without scanning all history.
    const entryDate = new Date(selectedDate);
    const recentSince = new Date(entryDate);
    recentSince.setUTCDate(recentSince.getUTCDate() - 45);
    const recentEntries = await withDbTimeout(
      prisma.dailyRouteEntry.findMany({
        where: { routeId: routePacket.id, entryDate: { lt: entryDate, gte: recentSince } },
        orderBy: { entryDate: "desc" },
        select: {
          lines: {
            where: { skipped: false },
            select: { customerId: true, productEntries: { select: { productId: true, quantity: true } } },
          },
        },
      }),
      "Daily entry recent order request",
    );

    // Newest-first, so the first non-empty delivery seen per customer is their
    // latest actual order.
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
        const recentOrder = recentOrderByCustomer.get(sequenceLine.customerId);

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
              lastQuantity: String(recentOrder?.get(product.id) ?? 0),
            };
          }),
          // Anything saved against this customer that is not a grid column.
          // Round-tripped so the next save doesn't delete it.
          extraItems: [...savedProducts.values()]
            .filter((saved) => productById.get(saved.productId)?.showInDailyEntry === false)
            .map((saved) => {
              const product = productById.get(saved.productId)!;

              return {
                productId: saved.productId,
                productCode: product.code,
                productName: product.name,
                productShortName: product.shortName,
                unit: product.unit,
                quantity: String(saved.quantity),
                rate: String(saved.rateSnapshot),
              };
            }),
        };
      }),
      occasionalProducts,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load daily entry data.";

    return fallbackPayload(selectedDate, message);
  }
}
