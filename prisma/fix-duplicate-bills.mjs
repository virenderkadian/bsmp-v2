// One-off repair for customers who ended up with MORE THAN ONE bill in a month.
//
// Cause: bills used to be keyed (customer, route), so a customer running a
// morning AND an evening route got two — while openingBalance and paymentAmount
// are looked up by CUSTOMER, so both bills repeated the same opening balance and
// the same payments. Month-end carry-forward then took whichever it saw first,
// dropping the other route's deliveries from the next month's opening balance.
//
// Going forward, generation writes one combined bill per customer and sweeps up
// DRAFT strays by itself. This script exists for the bills already written.
//
// DRY RUN BY DEFAULT — prints what it would do and changes nothing.
//   node prisma/fix-duplicate-bills.mjs            # report only
//   node prisma/fix-duplicate-bills.mjs --apply    # actually delete
//
// LOCKED bills are never touched: they are finalised, and their frozen
// paymentAmount is what the collection ledger treats as the boundary.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

function money(value) {
  return Number(value).toFixed(2);
}

async function main() {
  const duplicates = await prisma.$queryRaw`
    SELECT "customerId", "billingMonth"
    FROM "MonthlyBill"
    GROUP BY "customerId", "billingMonth"
    HAVING COUNT(*) > 1`;

  if (duplicates.length === 0) {
    console.log("No customer has more than one bill in a month. Nothing to do.");
    return;
  }

  console.log(`${duplicates.length} customer/month combination(s) with more than one bill.\n`);

  const toDelete = [];
  const blocked = [];

  for (const duplicate of duplicates) {
    const bills = await prisma.monthlyBill.findMany({
      where: { customerId: duplicate.customerId, billingMonth: duplicate.billingMonth },
      select: {
        id: true,
        routeId: true,
        status: true,
        openingBalance: true,
        deliveryAmount: true,
        paymentAmount: true,
        closingBalance: true,
        customer: { select: { code: true, name: true } },
        route: { select: { code: true } },
      },
    });

    // Where this customer is billed now, by the same rule the app uses: the row
    // flagged billsHere, else their earliest sequence row.
    //
    // Falls back to earliest-only when billsHere doesn't exist yet, so this can
    // be dry-run against a database that hasn't had the migration applied. That
    // matches what the migration itself backfills, so the preview is accurate.
    let sequenceRows;
    try {
      sequenceRows = await prisma.monthlyRouteCustomerSequence.findMany({
        where: {
          customerId: duplicate.customerId,
          sequenceMonth: duplicate.billingMonth,
          status: "ACTIVE",
        },
        orderBy: { createdAt: "asc" },
        select: { routeId: true, billsHere: true, route: { select: { code: true } } },
      });
    } catch {
      const rows = await prisma.monthlyRouteCustomerSequence.findMany({
        where: {
          customerId: duplicate.customerId,
          sequenceMonth: duplicate.billingMonth,
          status: "ACTIVE",
        },
        orderBy: { createdAt: "asc" },
        select: { routeId: true, route: { select: { code: true } } },
      });
      sequenceRows = rows.map((row) => ({ ...row, billsHere: false }));
    }

    const billingRow = sequenceRows.find((row) => row.billsHere) ?? sequenceRows[0];
    const month = new Date(duplicate.billingMonth).toISOString().slice(0, 7);
    const label = `${bills[0].customer.code} ${bills[0].customer.name} | ${month}`;

    // Keep the bill on the billing route. If the sequence no longer says (the
    // customer was removed from every route), keep the one with the most
    // delivery value rather than guessing — it's the one carrying real data.
    const keeper =
      (billingRow && bills.find((bill) => bill.routeId === billingRow.routeId)) ??
      [...bills].sort((left, right) => Number(right.deliveryAmount) - Number(left.deliveryAmount))[0];

    const others = bills.filter((bill) => bill.id !== keeper.id);
    const lockedOthers = others.filter((bill) => bill.status === "LOCKED");

    console.log(label);
    console.log(
      `  KEEP   ${keeper.route.code.padEnd(14)} ${keeper.status.padEnd(10)} open=${money(keeper.openingBalance)} del=${money(keeper.deliveryAmount)} paid=${money(keeper.paymentAmount)} close=${money(keeper.closingBalance)}`,
    );

    for (const bill of others) {
      const verdict = bill.status === "LOCKED" ? "SKIP (locked)" : "DELETE";
      console.log(
        `  ${verdict.padEnd(6)} ${bill.route.code.padEnd(14)} ${bill.status.padEnd(10)} open=${money(bill.openingBalance)} del=${money(bill.deliveryAmount)} paid=${money(bill.paymentAmount)} close=${money(bill.closingBalance)}`,
      );
    }

    if (lockedOthers.length > 0) {
      blocked.push(label);
      console.log("  -> left alone: a locked bill can't be removed automatically.\n");
      continue;
    }

    // REFUSED unless the keeper already covers every route's deliveries.
    //
    // The keeper is frequently the SMALLER bill — it's chosen by billing route,
    // not by amount. Deleting the others first would permanently drop the
    // difference: one real case here keeps 595.00 and deletes 2040.00. So the
    // order is regenerate FIRST (which rewrites the keeper to the combined
    // total, and sweeps up DRAFT strays on its own), and only then delete what
    // remains. Enforced here rather than left as a note someone has to
    // remember, because forgetting it silently under-bills a customer.
    const combinedDelivery = bills.reduce((sum, bill) => sum + Number(bill.deliveryAmount), 0);
    if (Number(keeper.deliveryAmount) !== combinedDelivery) {
      blocked.push(label);
      console.log(
        `  BLOCKED keeper delivery ${money(keeper.deliveryAmount)} != combined ${money(combinedDelivery)}`,
      );
      console.log("  -> regenerate this month FIRST, then re-run. Deleting now would lose the difference.\n");
      continue;
    }

    toDelete.push(...others.map((bill) => bill.id));
    console.log("");
  }

  console.log(`\n${toDelete.length} bill(s) safe to delete. ${blocked.length} left alone (locked, or need regenerating first).`);

  if (toDelete.length === 0) {
    console.log("\nNothing is safe to delete yet — regenerate the months listed above first.");
    return;
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing was changed. Re-run with --apply to perform the deletion.");
    return;
  }

  const result = await prisma.$transaction([
    prisma.monthlyBillItem.deleteMany({ where: { monthlyBillId: { in: toDelete } } }),
    prisma.monthlyBill.deleteMany({ where: { id: { in: toDelete } } }),
  ]);

  console.log(`\nDeleted ${result[1].count} bill(s) and ${result[0].count} bill item(s).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
