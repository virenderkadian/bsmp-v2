import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AdminAccess } from "@/lib/admin-app-auth";
import type { AdminVehiclePayment, AdminVehiclePaymentRequest, VehiclePaymentMode } from "@/lib/driver-api-types";
import { dayOffset, stockWindow, validDay } from "@/lib/driver-stock-rules";

// A vehicle's cash/online deposit, recorded from the admin side of the mobile app.
//
// Mirrors the web reconciliation page (src/app/reconciliation/actions.ts): the
// same table, and only VERIFIED deposits count towards what the driver still
// owes. An admin entering it is the person who verifies, so it is recorded as
// VERIFIED straight away. It is never deleted — a mistake is cancelled on the
// web, which keeps the trail.

const MODES: VehiclePaymentMode[] = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"];
const MAX_AMOUNT = 9_999_999.99;

export class VehiclePaymentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type Vehicle = { vehicleId: string; cityId: string };

function toPayment(row: { id: string; amount: Prisma.Decimal; mode: string; status: string; paymentDate: Date; referenceNo: string | null; notes: string | null; createdAt: Date }): AdminVehiclePayment {
  return {
    id: row.id, amount: String(row.amount), mode: row.mode as VehiclePaymentMode, status: row.status as AdminVehiclePayment["status"],
    paymentDate: row.paymentDate.toISOString().slice(0, 10), referenceNo: row.referenceNo, notes: row.notes, createdAt: row.createdAt.toISOString(),
  };
}

// The current cycle, or the one before it. After 4 pm the cycle moves on, and a
// deposit for the round that just ended must still be recordable; anything older
// than that is not something to enter from a phone.
export function allowedPaymentCycle(cycleDate: string, now = new Date()): boolean {
  if (!validDay(cycleDate)) return false;
  const current = stockWindow(now).cycleDate;
  return cycleDate === current || cycleDate === dayOffset(current, -1);
}

export async function listVehiclePayments(vehicle: Vehicle, cycleDate: string): Promise<AdminVehiclePayment[]> {
  if (!validDay(cycleDate)) throw new VehiclePaymentError("Invalid cycle date.");
  const rows = await prisma.vehicleCashSalePayment.findMany({
    where: { vehicleId: vehicle.vehicleId, cycleDate: new Date(`${cycleDate}T00:00:00Z`) },
    orderBy: { createdAt: "desc" },
    select: { id: true, amount: true, mode: true, status: true, paymentDate: true, referenceNo: true, notes: true, createdAt: true },
  });
  return rows.map(toPayment);
}

export async function recordVehiclePayment(access: AdminAccess, vehicle: Vehicle, input: AdminVehiclePaymentRequest): Promise<AdminVehiclePayment> {
  if (!/^[0-9a-f-]{36}$/i.test(input.requestId)) throw new VehiclePaymentError("Invalid request.");
  if (!allowedPaymentCycle(input.cycleDate)) throw new VehiclePaymentError("Payments can only be recorded for the current or previous cycle.");
  if (!MODES.includes(input.mode)) throw new VehiclePaymentError("Choose how it was paid.");
  if (!/^\d+(\.\d{1,2})?$/.test(input.amount)) throw new VehiclePaymentError("Enter a valid amount (up to 2 decimal places).");
  const amount = new Prisma.Decimal(input.amount);
  if (amount.lte(0)) throw new VehiclePaymentError("Amount must be greater than zero.");
  if (amount.gt(MAX_AMOUNT)) throw new VehiclePaymentError("Amount is too large.");
  const referenceNo = input.referenceNo?.trim() || null;
  const notes = input.notes?.trim() || null;
  if ((referenceNo?.length ?? 0) > 100 || (notes?.length ?? 0) > 500) throw new VehiclePaymentError("Reference or note is too long.");

  const cycle = new Date(`${input.cycleDate}T00:00:00Z`);
  try {
    // The payment and the record of who made it are one transaction: there is no
    // such thing as an unattributed payment.
    return await prisma.$transaction(async (tx) => {
      const payment = await tx.vehicleCashSalePayment.create({
        data: {
          id: input.requestId, vehicleId: vehicle.vehicleId, cycleDate: cycle, amount,
          paymentDate: new Date(`${stockWindow().today}T00:00:00Z`), mode: input.mode, status: "VERIFIED", referenceNo, notes,
        },
      });
      await tx.auditLog.create({
        data: {
          cityId: vehicle.cityId, actorId: access.userId, actorName: access.fullName, actorRole: access.role,
          entityType: "VehicleCashSalePayment", entityId: payment.id, action: "CREATE",
          summary: `Recorded a ${input.mode} deposit of ${payment.amount} for vehicle ${vehicle.vehicleId} (cycle ${input.cycleDate}) from the mobile app.`,
          after: { id: payment.id, vehicleId: vehicle.vehicleId, cycleDate: input.cycleDate, amount: String(payment.amount), mode: input.mode, status: "VERIFIED", referenceNo, notes } as Prisma.InputJsonValue,
        },
      });
      return toPayment(payment);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // This request id was already used. The very same entry sent again (a retry)
      // returns what was recorded; anything else is a clash.
      const existing = await prisma.vehicleCashSalePayment.findUnique({ where: { id: input.requestId } });
      if (existing && existing.vehicleId === vehicle.vehicleId && existing.amount.equals(amount) && existing.cycleDate.getTime() === cycle.getTime()) {
        return toPayment(existing);
      }
      throw new VehiclePaymentError("This request ID was already used.", 409);
    }
    throw error;
  }
}
