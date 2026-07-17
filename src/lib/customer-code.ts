// Deliberately a minimal structural type rather than Prisma.TransactionClient
// or PrismaClient — the city-scope-guard extension in src/lib/prisma.ts gives
// the app's `prisma` export a branded generic type that doesn't line up with
// either of those, even though it's fully compatible at runtime. Both the
// extended client and a raw $transaction tx client satisfy this shape.
type CustomerCodeClient = {
  city: {
    findUniqueOrThrow: (args: {
      where: { id: string };
      select: { code: true };
    }) => Promise<{ code: string }>;
  };
  customer: {
    findMany: (args: {
      where: { cityId: string; code: { startsWith: string } };
      select: { code: true };
    }) => Promise<Array<{ code: string }>>;
  };
};

// Prefix is the city's own code + "CID" (e.g. city code "BH" -> "BHCID"), so
// codes stay unique per city without colliding with another city's
// numbering — matches the @@unique([cityId, code]) constraint on Customer.
// Scans existing codes for the highest number under this prefix rather than
// counting rows, so a manually-entered or since-deleted code never causes a
// collision with the next generated one. Accepts either the base Prisma
// client or a $transaction callback's tx client, so callers that need the
// customer created atomically with something else (e.g. a route sequence
// line) can generate the code inside that same transaction.
export async function nextCustomerCode(
  client: CustomerCodeClient,
  cityId: string,
): Promise<string> {
  const city = await client.city.findUniqueOrThrow({ where: { id: cityId }, select: { code: true } });
  const prefix = `${city.code}CID`;

  const existing = await client.customer.findMany({
    where: { cityId, code: { startsWith: prefix } },
    select: { code: true },
  });

  let maxNumber = 0;
  for (const { code } of existing) {
    const match = code.slice(prefix.length).match(/^(\d+)$/);
    if (match) {
      maxNumber = Math.max(maxNumber, Number(match[1]));
    }
  }

  return `${prefix}${String(maxNumber + 1).padStart(4, "0")}`;
}
