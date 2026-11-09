import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  paymentCreate: vi.fn(), paymentFindUnique: vi.fn(), paymentFindMany: vi.fn(), auditCreate: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  vehicleCashSalePayment: { findUnique: mock.paymentFindUnique, findMany: mock.paymentFindMany },
  $transaction: mock.transaction,
} }));

import { allowedPaymentCycle, listVehiclePayments, recordVehiclePayment, VehiclePaymentError } from "@/lib/vehicle-payments";

const access = { userId: "11111111-1111-4111-8111-111111111111", fullName: "Asha Admin", role: "ADMIN" as const, cityIds: null };
const vehicle = { vehicleId: "22222222-2222-4222-8222-222222222222", cityId: "33333333-3333-4333-8333-333333333333" };
const requestId = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T05:00:00Z")); // 10:30 am India time: cycle is 10 Nov
  mock.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) =>
    work({ vehicleCashSalePayment: { create: mock.paymentCreate }, auditLog: { create: mock.auditCreate } }));
  mock.paymentCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...data, referenceNo: data.referenceNo ?? null, notes: data.notes ?? null, createdAt: new Date("2026-11-10T05:00:00Z"),
  }));
  mock.auditCreate.mockResolvedValue({});
});

const valid = { requestId, cycleDate: "2026-11-10", amount: "1500.50", mode: "CASH" as const };

describe("recordVehiclePayment", () => {
  it("records a verified deposit and the admin's name in one transaction", async () => {
    const payment = await recordVehiclePayment(access, vehicle, { ...valid, referenceNo: " UTR123 ", notes: "  " });
    expect(payment).toMatchObject({ id: requestId, amount: "1500.5", mode: "CASH", status: "VERIFIED", referenceNo: "UTR123", notes: null });
    expect(mock.transaction).toHaveBeenCalledTimes(1);
    expect(mock.paymentCreate.mock.calls[0][0].data).toMatchObject({ id: requestId, vehicleId: vehicle.vehicleId, status: "VERIFIED" });
    expect(mock.auditCreate.mock.calls[0][0].data).toMatchObject({
      actorId: access.userId, actorName: "Asha Admin", actorRole: "ADMIN", entityType: "VehicleCashSalePayment", action: "CREATE", cityId: vehicle.cityId,
    });
  });

  it("fails, rather than recording an unattributed payment, when the audit record cannot be written", async () => {
    mock.auditCreate.mockRejectedValue(new Error("db down"));
    await expect(recordVehiclePayment(access, vehicle, valid)).rejects.toThrow("db down");
  });

  it.each([["0"], ["-5"], ["12.345"], ["abc"], [""], ["10000000"]])("rejects an invalid amount %s", async (amount) => {
    await expect(recordVehiclePayment(access, vehicle, { ...valid, amount })).rejects.toBeInstanceOf(VehiclePaymentError);
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it("rejects a mode that does not exist, a bad id, and an over-long note", async () => {
    await expect(recordVehiclePayment(access, vehicle, { ...valid, mode: "BARTER" as never })).rejects.toBeInstanceOf(VehiclePaymentError);
    await expect(recordVehiclePayment(access, vehicle, { ...valid, requestId: "nope" })).rejects.toBeInstanceOf(VehiclePaymentError);
    await expect(recordVehiclePayment(access, vehicle, { ...valid, notes: "x".repeat(501) })).rejects.toBeInstanceOf(VehiclePaymentError);
  });

  it("rejects a cycle that is neither the current nor the previous one", async () => {
    await expect(recordVehiclePayment(access, vehicle, { ...valid, cycleDate: "2026-11-08" })).rejects.toThrow("current or previous cycle");
    await expect(recordVehiclePayment(access, vehicle, { ...valid, cycleDate: "2026-11-11" })).rejects.toThrow("current or previous cycle");
    await expect(recordVehiclePayment(access, vehicle, { ...valid, cycleDate: "2026-11-31" })).rejects.toThrow("current or previous cycle");
  });

  it("returns the same payment when the identical request is sent again", async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });
    mock.transaction.mockRejectedValue(duplicate);
    mock.paymentFindUnique.mockResolvedValue({
      id: requestId, vehicleId: vehicle.vehicleId, amount: new Prisma.Decimal("1500.5"), cycleDate: new Date("2026-11-10T00:00:00Z"),
      mode: "CASH", status: "VERIFIED", paymentDate: new Date("2026-11-10T00:00:00Z"), referenceNo: null, notes: null, createdAt: new Date(),
    });
    expect(await recordVehiclePayment(access, vehicle, valid)).toMatchObject({ id: requestId, amount: "1500.5" });
  });

  it("refuses a reused request id carrying a different amount", async () => {
    mock.transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    mock.paymentFindUnique.mockResolvedValue({
      id: requestId, vehicleId: vehicle.vehicleId, amount: new Prisma.Decimal("99"), cycleDate: new Date("2026-11-10T00:00:00Z"),
      mode: "CASH", status: "VERIFIED", paymentDate: new Date(), referenceNo: null, notes: null, createdAt: new Date(),
    });
    await expect(recordVehiclePayment(access, vehicle, valid)).rejects.toMatchObject({ status: 409 });
  });
});

describe("allowedPaymentCycle", () => {
  it("allows the current and previous cycle, and moves on at 4 pm India time", () => {
    expect(allowedPaymentCycle("2026-11-10", new Date("2026-11-10T05:00:00Z"))).toBe(true);
    expect(allowedPaymentCycle("2026-11-09", new Date("2026-11-10T05:00:00Z"))).toBe(true);
    // 5 pm India time on the 10th: the cycle is now the 11th, so the 10th is "previous".
    expect(allowedPaymentCycle("2026-11-11", new Date("2026-11-10T11:30:00Z"))).toBe(true);
    expect(allowedPaymentCycle("2026-11-10", new Date("2026-11-10T11:30:00Z"))).toBe(true);
    expect(allowedPaymentCycle("2026-11-09", new Date("2026-11-10T11:30:00Z"))).toBe(false);
  });
});

describe("listVehiclePayments", () => {
  it("reads one cycle's deposits for the vehicle, newest first", async () => {
    mock.paymentFindMany.mockResolvedValue([]);
    await listVehiclePayments(vehicle, "2026-11-10");
    expect(mock.paymentFindMany.mock.calls[0][0]).toMatchObject({ where: { vehicleId: vehicle.vehicleId }, orderBy: { createdAt: "desc" } });
    await expect(listVehiclePayments(vehicle, "garbage")).rejects.toBeInstanceOf(VehiclePaymentError);
  });
});
