import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DriverStockAction, DriverStockRequest, DriverStockResponse } from "@/lib/driver-api-types";
import { dayOffset, stockAuditWindow, stockWindow, validDay } from "@/lib/driver-stock-rules";

const stockActions = new Set<DriverStockAction>(["EVENING_TAKEN", "EVENING_REFILL", "EVENING_RETURN", "MORNING_REFILL", "MORNING_RETURN"]);
type AuditAfter = { cycleDate?: string; productId?: string; requestId?: string };
type SoldRow = { productId: string; shift: "EVENING" | "MORNING"; quantity: Prisma.Decimal };
function isStockAudit(after: unknown, cycleDate: string, productId: string) {
  if (!after || typeof after !== "object" || Array.isArray(after)) return false;
  const value = after as AuditAfter;
  return value.cycleDate === cycleDate && value.productId === productId;
}
function isSameRequest(after: unknown, input: DriverStockRequest) {
  return isStockAudit(after, input.cycleDate, input.productId)
    && (after as AuditAfter & { quantity?: string }).quantity === input.quantity;
}

export async function getDriverStock(vehicleId: string, cityId: string, requestedCycle?: string): Promise<DriverStockResponse> {
  const window = stockWindow();
  if (requestedCycle && !validDay(requestedCycle)) throw new StockError("Invalid cycle date.");
  const cycleDate = requestedCycle ?? window.cycleDate;
  const eveningDate = dayOffset(cycleDate, -1);
  const [products, rows, audits, deposits, soldRows] = await Promise.all([
    prisma.product.findMany({ where: { cityId, isActive: true, includeInReconciliation: true }, orderBy: { displayOrder: "asc" }, select: { id: true, name: true, unit: true, defaultRate: true } }),
    prisma.vehicleCycleStock.findMany({ where: { vehicleId, cycleDate: new Date(`${cycleDate}T00:00:00Z`), product: { cityId } }, select: { productId: true, givenQty: true, returnedQty: true, rateSnapshot: true } }),
    prisma.auditLog.findMany({ where: { cityId, entityType: "DriverStock", entityId: vehicleId, action: { in: ["EVENING_TAKEN", "EVENING_RETURN", "MORNING_RETURN"] }, createdAt: stockAuditWindow(cycleDate) }, select: { action: true, after: true } }),
    prisma.vehicleCashSalePayment.aggregate({ where: { vehicleId, cycleDate: new Date(`${cycleDate}T00:00:00Z`), status: "VERIFIED" }, _sum: { amount: true } }),
    prisma.$queryRaw<SoldRow[]>`
      SELECT dp."productId" AS "productId", r."shift"::text AS "shift",
        SUM(dp."quantity")::numeric AS "quantity"
      FROM "DailyRouteEntry" e
      JOIN "Route" r ON r.id = e."routeId"
      JOIN "DailyRouteEntryLine" dl ON dl."entryId" = e.id
      JOIN "DailyRouteEntryLineProduct" dp ON dp."lineId" = dl.id
      WHERE r."cityId" = ${cityId}::uuid
        AND COALESCE(e."vehicleId", r."vehicleId") = ${vehicleId}::uuid
        AND ((r."shift" = 'EVENING' AND e."entryDate" = ${eveningDate}::date)
          OR (r."shift" = 'MORNING' AND e."entryDate" = ${cycleDate}::date))
      GROUP BY dp."productId", r."shift"
    `,
  ]);
  const stock = new Map(rows.map((row) => [row.productId, row]));
  const sold = new Map(soldRows.map((row) => [`${row.productId}:${row.shift}`, String(row.quantity)]));
  const result = products.map((product) => {
    const events = audits.filter((audit) => isStockAudit(audit.after, cycleDate, product.id));
    return {
      id: product.id, name: product.name, unit: product.unit,
      given: String(stock.get(product.id)?.givenQty ?? 0), returned: String(stock.get(product.id)?.returnedQty ?? 0),
      eveningSold: sold.get(`${product.id}:EVENING`) ?? "0",
      morningSold: sold.get(`${product.id}:MORNING`) ?? "0",
      rate: String(stock.get(product.id)?.rateSnapshot ?? product.defaultRate ?? 0),
      eveningTakenRecorded: events.some((event) => event.action === "EVENING_TAKEN"),
      eveningReturnRecorded: events.some((event) => event.action === "EVENING_RETURN"),
      morningReturnRecorded: events.some((event) => event.action === "MORNING_RETURN"),
    };
  });
  return { cycleDate, eveningDate, shift: cycleDate === window.cycleDate ? window.shift : "MORNING", editable: cycleDate === window.cycleDate,
    complete: result.length > 0 && result.every((product) => product.morningReturnRecorded),
    depositedVerified: String(deposits._sum.amount ?? 0), products: result };
}

export class StockError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function saveDriverStock(vehicleId: string, cityId: string, input: DriverStockRequest) {
  if (!stockActions.has(input.action) || !validDay(input.cycleDate) || !/^[0-9a-f-]{36}$/i.test(input.requestId)) throw new StockError("Invalid stock request.");
  if (!/^\d+(\.\d{1,3})?$/.test(input.quantity)) throw new StockError("Enter a valid quantity (up to 3 decimal places).");
  const quantity = new Prisma.Decimal(input.quantity);
  if (quantity.gt(9999999)) throw new StockError("Quantity is too large.");
  if (input.action !== "MORNING_RETURN" && quantity.lte(0)) throw new StockError("Quantity must be greater than zero.");
  const product = await prisma.product.findFirst({ where: { id: input.productId, cityId, isActive: true, includeInReconciliation: true }, select: { id: true, defaultRate: true } });
  if (!product) throw new StockError("Product is not available for reconciliation.", 404);
  const alreadySaved = await prisma.auditLog.findUnique({ where: { id: input.requestId }, select: { entityId: true, action: true, after: true } });
  if (alreadySaved) {
    if (alreadySaved.entityId === vehicleId && alreadySaved.action === input.action && isSameRequest(alreadySaved.after, input)) return getDriverStock(vehicleId, cityId);
    throw new StockError("This request ID was already used.", 409);
  }
  const window = stockWindow();
  if (input.cycleDate !== window.cycleDate) throw new StockError("This stock cycle is view only.", 409);
  if (input.action.startsWith("EVENING") !== (window.shift === "EVENING")) throw new StockError("This action is not available in the current shift.", 409);
  const cycleDate = new Date(`${input.cycleDate}T00:00:00Z`);
  try {
    await prisma.$transaction(async (tx) => {
      const previous = await tx.vehicleCycleStock.findUnique({ where: { vehicleId_productId_cycleDate: { vehicleId, productId: product.id, cycleDate } } });
      const audits = await tx.auditLog.findMany({ where: { cityId, entityType: "DriverStock", entityId: vehicleId, action: { in: ["EVENING_TAKEN", "EVENING_RETURN", "MORNING_RETURN"] }, createdAt: stockAuditWindow(input.cycleDate) }, select: { action: true, after: true } });
      const done = (action: DriverStockAction) => audits.some((audit) => audit.action === action && isStockAudit(audit.after, input.cycleDate, product.id));
      if (input.action === "EVENING_TAKEN" && done("EVENING_TAKEN")) throw new StockError("Stock taken was already recorded for this product.", 409);
      if (input.action === "EVENING_RETURN" && done("EVENING_RETURN")) throw new StockError("Evening return was already recorded for this product.", 409);
      if (input.action === "MORNING_RETURN" && done("MORNING_RETURN")) throw new StockError("Final return was already recorded for this product.", 409);
      if (input.action === "MORNING_REFILL" && done("MORNING_RETURN")) throw new StockError("Final return was already recorded for this product.", 409);
      const given = new Prisma.Decimal(previous?.givenQty ?? 0).plus(input.action === "MORNING_RETURN" ? 0 : input.action === "EVENING_RETURN" ? quantity.negated() : quantity);
      if (given.isNegative()) throw new StockError("Return cannot exceed the stock given.", 409);
      const returned = input.action === "MORNING_RETURN" ? quantity : new Prisma.Decimal(previous?.returnedQty ?? 0);
      await tx.vehicleCycleStock.upsert({ where: { vehicleId_productId_cycleDate: { vehicleId, productId: product.id, cycleDate } },
        create: { vehicleId, productId: product.id, cycleDate, givenQty: given, returnedQty: returned, rateSnapshot: product.defaultRate },
        update: { givenQty: given, returnedQty: returned } });
      await tx.auditLog.create({ data: { id: input.requestId, cityId, actorName: `Vehicle ${vehicleId}`, actorRole: "DRIVER_VEHICLE",
        entityType: "DriverStock", entityId: vehicleId, action: input.action,
        summary: `${input.action} ${input.quantity} for product ${product.id} on ${input.cycleDate}`,
        before: { given: String(previous?.givenQty ?? 0), returned: String(previous?.returnedQty ?? 0) },
        after: { requestId: input.requestId, cycleDate: input.cycleDate, productId: product.id, quantity: input.quantity, given: String(given), returned: String(returned) } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.auditLog.findUnique({ where: { id: input.requestId }, select: { entityId: true, action: true, after: true } });
      if (existing?.entityId === vehicleId && existing.action === input.action && isSameRequest(existing.after, input)) return getDriverStock(vehicleId, cityId);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw new StockError("Stock changed while saving. Please try again.", 409);
    throw error;
  }
  return getDriverStock(vehicleId, cityId);
}
