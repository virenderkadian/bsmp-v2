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

// The delivery sheet for one route + date: the month's customer sequence in
// order, each with its pre-filled deliverables and any marks already saved.
// Returns null when the route isn't this vehicle's (or doesn't exist).
export async function getDriverSheet(
  vehicleId: string,
  routeId: string,
  dateInput: string,
): Promise<DriverSheetResponse | null> {
  const sequenceMonth = toMonthStart(dateInput);
  const entryDate = toDay(dateInput);

  const route = await prisma.route.findFirst({
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
          customer: { select: { name: true, area: true, mobile: true } },
        },
      },
      assignments: {
        where: { status: "ACTIVE" },
        select: {
          customerId: true,
          defaults: {
            select: {
              productId: true,
              defaultQty: true,
              defaultRate: true,
              product: { select: { code: true, shortName: true, unit: true, displayOrder: true } },
            },
          },
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
  });

  if (!route) {
    return null;
  }

  const defaultsByCustomer = new Map(route.assignments.map((assignment) => [assignment.customerId, assignment.defaults]));
  const lineByCustomer = new Map((route.entries[0]?.lines ?? []).map((line) => [line.customerId, line]));

  const customers: DriverSheetCustomer[] = route.monthlySequences.map((seq) => {
    const defaults = [...(defaultsByCustomer.get(seq.customerId) ?? [])].sort(
      (a, b) => a.product.displayOrder - b.product.displayOrder || a.product.code.localeCompare(b.product.code),
    );
    const savedLine = lineByCustomer.get(seq.customerId);
    const savedProducts = new Map((savedLine?.productEntries ?? []).map((entry) => [entry.productId, entry]));

    const products: DriverSheetProduct[] = defaults.map((def) => {
      const saved = savedProducts.get(def.productId);
      return {
        productId: def.productId,
        code: def.product.code,
        shortName: def.product.shortName,
        unit: def.product.unit,
        rate: String(saved?.rateSnapshot ?? def.defaultRate),
        defaultQty: String(def.defaultQty),
        deliveredQty: String(saved?.quantity ?? def.defaultQty),
      };
    });

    return {
      customerId: seq.customerId,
      sequenceNo: seq.sequenceNo,
      name: seq.customer.name,
      area: seq.customer.area,
      mobile: seq.customer.mobile,
      products,
      skipped: savedLine?.skipped ?? false,
      remarks: savedLine?.remarks ?? null,
      saved: Boolean(savedLine),
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
  });

  const sheet = await getDriverSheet(vehicleId, routeId, dateInput);
  const customer = sheet?.customers.find((entry) => entry.customerId === customerId);
  if (!customer) {
    return { ok: false, error: "Saved, but could not reload the customer." };
  }
  return { ok: true, customer };
}
