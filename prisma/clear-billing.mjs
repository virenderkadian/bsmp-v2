import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$transaction([
    prisma.monthlyBillItem.deleteMany(),
    prisma.monthlyBill.deleteMany(),
    prisma.payment.deleteMany(),
  ]);

  console.log(
    [
      `Monthly bill items deleted: ${result[0].count}`,
      `Monthly bills deleted: ${result[1].count}`,
      `Payments deleted: ${result[2].count}`,
    ].join("\n"),
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
