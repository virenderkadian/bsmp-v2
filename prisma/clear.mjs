import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction([
    prisma.dailyRouteEntryLineProduct.deleteMany(),
    prisma.dailyRouteEntryLine.deleteMany(),
    prisma.dailyRouteEntry.deleteMany(),
    prisma.monthlyBillItem.deleteMany(),
    prisma.monthlyBill.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.routeCustomerProductDefault.deleteMany(),
    prisma.monthlyRouteCustomerSequence.deleteMany(),
    prisma.routeCustomerAssignment.deleteMany(),
    prisma.route.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.product.deleteMany(),
    prisma.vehicle.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  console.log("Database cleared. No dummy or seeded operational data remains.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
