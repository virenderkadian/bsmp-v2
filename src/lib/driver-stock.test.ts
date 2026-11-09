import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  productFindMany: vi.fn(), productFindFirst: vi.fn(), stockFindMany: vi.fn(),
  auditFindMany: vi.fn(), auditFindUnique: vi.fn(), queryRaw: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  product: { findMany: mock.productFindMany, findFirst: mock.productFindFirst },
  vehicleCycleStock: { findMany: mock.stockFindMany },
  vehicleCashSalePayment: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
  auditLog: { findMany: mock.auditFindMany, findUnique: mock.auditFindUnique },
  $queryRaw: mock.queryRaw, $transaction: mock.transaction,
} }));

import { getDriverStock, saveDriverStock } from "@/lib/driver-stock";

const vehicleId = "11111111-1111-4111-8111-111111111111";
const cityId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
const cycleDate = "2026-11-09";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-08T11:00:00Z")); // 4:30 pm India time
  mock.productFindMany.mockResolvedValue([{ id: productId, name: "Buffalo Milk", unit: "L" }]);
  mock.stockFindMany.mockResolvedValue([{ productId, givenQty: "80", returnedQty: "0" }]);
  mock.auditFindMany.mockResolvedValue([
    { action: "EVENING_TAKEN", after: { cycleDate, productId } },
    { action: "EVENING_RETURN", after: { cycleDate, productId } },
  ]);
  mock.queryRaw.mockResolvedValue([
    { productId, shift: "EVENING", quantity: "60" },
    { productId, shift: "MORNING", quantity: "10" },
  ]);
  mock.productFindFirst.mockResolvedValue({ id: productId, defaultRate: "50" });
  mock.auditFindUnique.mockResolvedValue(null);
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("driver stock", () => {
  it("shows both shift sales and recognizes an evening return", async () => {
    const stock = await getDriverStock(vehicleId, cityId);
    expect(stock.products[0]).toMatchObject({
      eveningSold: "60", morningSold: "10", eveningReturnRecorded: true,
    });
  });

  it("rejects a second evening return before changing totals", async () => {
    const upsert = vi.fn();
    const createAudit = vi.fn();
    mock.transaction.mockImplementation(async (action: (tx: unknown) => Promise<unknown>) => action({
      vehicleCycleStock: { findUnique: vi.fn().mockResolvedValue({ givenQty: "80", returnedQty: "0" }), upsert },
      auditLog: { findMany: mock.auditFindMany, create: createAudit },
    }));
    await expect(saveDriverStock(vehicleId, cityId, {
      requestId: "44444444-4444-4444-8444-444444444444", cycleDate,
      productId, action: "EVENING_RETURN", quantity: "5",
    })).rejects.toThrow("Evening return was already recorded");
    expect(upsert).not.toHaveBeenCalled();
    expect(createAudit).not.toHaveBeenCalled();
  });
});
