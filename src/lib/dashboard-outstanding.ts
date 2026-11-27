import "server-only";
import { customersOwing, type CustomerPayments, type IssuedBill } from "@/lib/customer-dues";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";

// Who owes money right now, for the dashboard card and its list. It uses the same rule as the
// driver app's dues screen and the WhatsApp reminders (customer-dues.ts), so the card total,
// the list and those screens always agree. This is the position as of now, not as of the date
// picked on the dashboard: a past balance cannot be rebuilt from the bills kept.
export type OutstandingCustomer = {
  customerId: string;
  customerCode: string;
  customerName: string;
  routeId: string;
  routeLabel: string;
  vehicleId: string;
  vehicleLabel: string;
  outstanding: number;
};

export async function getOutstandingCustomers(cityId: string): Promise<{ rows: OutstandingCustomer[]; total: number }> {
  const candidateRows = await withDbTimeout(
    prisma.monthlyBill.findMany({
      where: { route: { cityId, isActive: true }, status: "GENERATED", closingBalance: { gt: 0 } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
    "Loading customers who owe",
    15_000,
  );
  if (candidateRows.length === 0) {
    return { rows: [], total: 0 };
  }
  const customerIds = candidateRows.map((row) => row.customerId);

  const [issuedBills, verified, customers] = await withDbTimeout(
    Promise.all([
      prisma.monthlyBill.findMany({
        where: { customerId: { in: customerIds }, status: { in: ["GENERATED", "LOCKED"] }, route: { cityId } },
        select: {
          id: true, customerId: true, routeId: true, billingMonth: true, status: true, paymentAmount: true, closingBalance: true,
          route: { select: { isActive: true, code: true, name: true, vehicle: { select: { id: true, code: true, name: true } } } },
        },
      }),
      prisma.payment.groupBy({
        by: ["customerId"],
        where: { customerId: { in: customerIds }, status: "VERIFIED", route: { cityId } },
        _sum: { amount: true },
      }),
      prisma.customer.findMany({
        where: { id: { in: customerIds }, cityId },
        select: { id: true, code: true, name: true },
      }),
    ]),
    "Loading outstanding customers",
    20_000,
  );

  const issued: IssuedBill[] = issuedBills.map((bill) => ({
    billId: bill.id,
    customerId: bill.customerId,
    routeId: bill.routeId,
    month: bill.billingMonth.toISOString().slice(0, 7),
    status: bill.status as "GENERATED" | "LOCKED",
    paymentAmount: Number(bill.paymentAmount),
    closingBalance: Number(bill.closingBalance),
  }));
  const lockedPaid = new Map<string, number>();
  for (const bill of issued) {
    if (bill.status === "LOCKED") {
      lockedPaid.set(bill.customerId, (lockedPaid.get(bill.customerId) ?? 0) + bill.paymentAmount);
    }
  }
  const payments = new Map<string, CustomerPayments>(
    verified.map((row) => [row.customerId, { totalVerified: Number(row._sum.amount ?? 0), lockedPaid: lockedPaid.get(row.customerId) ?? 0 }]),
  );
  const routeInfo = new Map(issuedBills.map((bill) => [bill.routeId, bill.route]));
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));

  const rows: OutstandingCustomer[] = [];
  let total = 0;
  for (const [customerId, due] of customersOwing(issued, payments)) {
    const route = routeInfo.get(due.bill.routeId);
    const customer = customerById.get(customerId);
    // The billing route must still be running, as on the driver dues list.
    if (!route?.isActive || !customer) continue;
    total += due.outstanding;
    rows.push({
      customerId,
      customerCode: customer.code,
      customerName: customer.name,
      routeId: due.bill.routeId,
      routeLabel: `${route.code} - ${route.name}`,
      vehicleId: route.vehicle.id,
      vehicleLabel: route.vehicle.name,
      outstanding: due.outstanding,
    });
  }
  rows.sort((a, b) => a.customerCode.localeCompare(b.customerCode, undefined, { numeric: true }));
  return { rows, total: Math.round(total * 100) / 100 };
}
