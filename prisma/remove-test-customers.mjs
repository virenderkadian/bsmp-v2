// Removes early test customers that ended up in the production database.
//
// They are inactive, have no delivery history, and carry token payments, but
// they still hold non-zero balances — so they surface as real people who owe
// money in the Outstanding section and count toward city collection totals.
//
// DRY RUN BY DEFAULT — prints every row it would delete and changes nothing.
//   node prisma/remove-test-customers.mjs
//   node prisma/remove-test-customers.mjs --apply
//
// REFUSES to touch a customer with any delivery lines or any LOCKED bill. A
// customer with real delivery history is not test data, whatever their code
// looks like, and a locked bill is finalised financial state.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const CODES = ["cus01", "cus03", "CUS-04"];

async function main() {
  const customers = await prisma.customer.findMany({
    where: { code: { in: CODES } },
    select: { id: true, code: true, name: true, isActive: true, city: { select: { name: true } } },
  });

  if (customers.length === 0) {
    console.log("No matching customers found — nothing to do.");
    return;
  }

  const found = customers.map((customer) => customer.code);
  const missing = CODES.filter((code) => !found.includes(code));
  if (missing.length > 0) {
    console.log(`Not found (skipping): ${missing.join(", ")}\n`);
  }

  const safe = [];

  for (const customer of customers) {
    const [bills, payments, lines, sequences, assignments] = await Promise.all([
      prisma.monthlyBill.findMany({
        where: { customerId: customer.id },
        select: { id: true, status: true, billingMonth: true, closingBalance: true },
      }),
      prisma.payment.findMany({ where: { customerId: customer.id }, select: { id: true, amount: true, status: true } }),
      prisma.dailyRouteEntryLine.count({ where: { customerId: customer.id } }),
      prisma.monthlyRouteCustomerSequence.count({ where: { customerId: customer.id } }),
      prisma.routeCustomerAssignment.count({ where: { customerId: customer.id } }),
    ]);

    const locked = bills.filter((bill) => bill.status === "LOCKED");

    console.log(`${customer.code} — ${customer.name}  [${customer.city.name}] active=${customer.isActive}`);
    console.log(`  bills: ${bills.length}`, bills.map((b) => `${b.billingMonth.toISOString().slice(0, 7)}:${b.status}`).join(" | "));
    console.log(`  payments: ${payments.length} (${payments.map((p) => p.amount).join(", ")})`);
    console.log(`  delivery lines: ${lines} | sequence rows: ${sequences} | assignments: ${assignments}`);

    if (lines > 0) {
      console.log("  SKIPPED: has real delivery history — this is not test data.\n");
      continue;
    }
    if (locked.length > 0) {
      console.log(`  SKIPPED: ${locked.length} LOCKED bill(s) — finalised financial state.\n`);
      continue;
    }

    console.log("  -> will be deleted with all rows above\n");
    safe.push({ customer, billIds: bills.map((bill) => bill.id) });
  }

  console.log(`${safe.length} of ${customers.length} customer(s) safe to remove.`);

  if (safe.length === 0) {
    return;
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing was changed. Re-run with --apply to delete.");
    return;
  }

  const customerIds = safe.map((entry) => entry.customer.id);
  const billIds = safe.flatMap((entry) => entry.billIds);

  // Children before parents; one transaction so a failure leaves nothing
  // half-deleted.
  const result = await prisma.$transaction(async (tx) => {
    const items = await tx.monthlyBillItem.deleteMany({ where: { monthlyBillId: { in: billIds } } });
    const bills = await tx.monthlyBill.deleteMany({ where: { id: { in: billIds } } });
    const payments = await tx.payment.deleteMany({ where: { customerId: { in: customerIds } } });
    const sequences = await tx.monthlyRouteCustomerSequence.deleteMany({ where: { customerId: { in: customerIds } } });

    // RouteCustomerProductDefault hangs off the assignment, not the customer,
    // so it has to go first — deleting assignments straight away violates its
    // foreign key. (Neither table is written by the app any more, but old rows
    // from before the monthly-sequence model still exist.)
    const assignmentIds = (
      await tx.routeCustomerAssignment.findMany({
        where: { customerId: { in: customerIds } },
        select: { id: true },
      })
    ).map((assignment) => assignment.id);

    const productDefaults = await tx.routeCustomerProductDefault.deleteMany({
      where: { assignmentId: { in: assignmentIds } },
    });
    const assignments = await tx.routeCustomerAssignment.deleteMany({ where: { id: { in: assignmentIds } } });
    const customers = await tx.customer.deleteMany({ where: { id: { in: customerIds } } });
    return { items, bills, payments, sequences, productDefaults, assignments, customers };
  });

  console.log(
    `\nDeleted: ${result.customers.count} customer(s), ${result.bills.count} bill(s), ` +
      `${result.items.count} bill item(s), ${result.payments.count} payment(s), ` +
      `${result.sequences.count} sequence row(s), ${result.assignments.count} assignment(s), ` +
      `${result.productDefaults.count} product default(s).`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
