import type { EntrySyncStatus, RouteShift } from "@prisma/client";
import { getCurrentCityId } from "@/lib/current-city";
import { withDbTimeout } from "@/lib/db-timeout";
import { computeModeQuantity, computeQuantityBand } from "@/lib/quantity-baseline";
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
  // The band a typed quantity should fall inside to look normal for this
  // customer — see src/lib/quantity-baseline.ts for exactly how it's built
  // and why. Null when there isn't enough history yet — no band means no
  // check, never a guess dressed up as one.
  unusualBandMin: string | null;
  unusualBandMax: string | null;
  // This customer's own last several non-zero deliveries of this product,
  // comma-separated, newest first — sent down so the screen can exempt an
  // exact repeat from the unusual check even when it sits outside the band
  // (see the "seen before" exemption in quantity-baseline.ts). Empty string
  // when there's no history.
  recentQuantities: string;
  // The most frequent of those recent quantities — a real number this
  // customer has actually ordered, shown as "usually takes X" instead of the
  // median, which can land on a value they've never once taken. Null when
  // there isn't enough history yet.
  modeQuantity: string | null;
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

    // What each customer most recently took ON THIS ROUTE, and their recent
    // history per product, so the operator can see their usual order while
    // typing instead of recalling it — read from CustomerProductRecentOrder,
    // a small table saveDailyEntry keeps up to date incrementally, instead
    // of re-scanning 45 days of raw deliveries on every page load (that scan
    // was reading millions of rows a month for this one feature). The raw
    // per-product history is kept (not just an average) because the "seen
    // before" exemption in quantity-baseline.ts needs an exact match against
    // it, not a derived statistic.
    const routeCustomerIds = routePacket.monthlySequences.map((sequence) => sequence.customerId);
    const recentOrders = routeCustomerIds.length === 0
      ? []
      : await withDbTimeout(
          prisma.customerProductRecentOrder.findMany({
            where: { customerId: { in: routeCustomerIds } },
            select: { customerId: true, productId: true, entries: true },
          }),
          "Daily entry recent order request",
        );

    const recentQuantitiesByCustomerProduct = new Map<string, number[]>();
    // Per customer: the newest date any of their products was delivered —
    // "their last visit." A product not part of that visit's basket reads as
    // 0 for lastQuantity below even if it was bought a few days earlier;
    // that distinction is the whole reason this isn't just "this product's
    // own most recent delivery."
    const newestDateByCustomer = new Map<string, string>();
    const basketByCustomerDate = new Map<string, Map<string, number>>();

    for (const order of recentOrders) {
      const entries = order.entries as Array<{ date: string; quantity: number }>;
      recentQuantitiesByCustomerProduct.set(
        `${order.customerId}:${order.productId}`,
        entries.map((entry) => entry.quantity),
      );

      // Stored newest-first by saveDailyEntry, so entries[0] is this
      // customer+product's own most recent delivery.
      const newest = entries[0];
      if (!newest) {
        continue;
      }
      const currentNewest = newestDateByCustomer.get(order.customerId);
      if (!currentNewest || newest.date > currentNewest) {
        newestDateByCustomer.set(order.customerId, newest.date);
      }
      const basketKey = `${order.customerId}:${newest.date}`;
      let basket = basketByCustomerDate.get(basketKey);
      if (!basket) {
        basket = new Map();
        basketByCustomerDate.set(basketKey, basket);
      }
      basket.set(order.productId, newest.quantity);
    }

    const recentOrderByCustomer = new Map<string, Map<string, number>>();
    for (const [customerId, newestDate] of newestDateByCustomer) {
      const basket = basketByCustomerDate.get(`${customerId}:${newestDate}`);
      if (basket) {
        recentOrderByCustomer.set(customerId, basket);
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
            const recentQuantities =
              recentQuantitiesByCustomerProduct.get(`${sequenceLine.customerId}:${product.id}`) ?? [];
            const band = computeQuantityBand(recentQuantities);
            const modeQuantity = computeModeQuantity(recentQuantities);

            return {
              productId: product.id,
              productCode: product.code,
              productName: product.name,
              productShortName: product.shortName,
              unit: product.unit,
              quantity: String(saved?.quantity ?? 0),
              defaultRate: String(saved?.rateSnapshot ?? product.defaultRate),
              lastQuantity: String(recentOrder?.get(product.id) ?? 0),
              unusualBandMin: band ? String(band.min) : null,
              unusualBandMax: band ? String(band.max) : null,
              recentQuantities: recentQuantities.join(","),
              modeQuantity: modeQuantity !== null ? String(modeQuantity) : null,
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
