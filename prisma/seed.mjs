import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const counts = await Promise.all([
    prisma.product.count(),
    prisma.customer.count(),
    prisma.route.count(),
    prisma.routeCustomerAssignment.count(),
    prisma.monthlyRouteCustomerSequence.count(),
  ]);

  console.log("Seed script is intentionally empty for real-data testing.");
  console.log(
    `Current records -> products: ${counts[0]}, customers: ${counts[1]}, routes: ${counts[2]}, assignments: ${counts[3]}, monthly sequences: ${counts[4]}`,
  );
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
