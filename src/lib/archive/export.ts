import "server-only";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { prisma } from "@/lib/prisma";

export type ArchiveExportResult = {
  buffer: Buffer; // gzip-compressed JSONL
  checksum: string; // sha256 of the UNCOMPRESSED JSONL — what verify/restore check against
  entryCount: number;
  lineCount: number;
  productEntryCount: number;
  sequenceCount: number;
};

export function monthBounds(billingMonth: Date) {
  const start = billingMonth;
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

export function archiveStorageKey(cityCode: string, routeCode: string, billingMonth: Date) {
  const monthLabel = billingMonth.toISOString().slice(0, 7); // YYYY-MM
  return `daily-entries/${cityCode}/${routeCode}/${monthLabel}.jsonl.gz`;
}

// One JSON object per line, each tagged with which table it came from —
// simple to stream, simple to restore (group by table, insert in FK order:
// DailyRouteEntry -> DailyRouteEntryLine -> DailyRouteEntryLineProduct,
// MonthlyRouteCustomerSequence independently). Decimal/DateTime fields
// round-trip exactly: Prisma's Decimal has its own toJSON() (serializes to
// a string, not a lossy float) and Prisma accepts that same string shape
// back on insert.
export async function buildArchiveExport(routeId: string, billingMonth: Date): Promise<ArchiveExportResult> {
  const { start, end } = monthBounds(billingMonth);

  const [entries, sequences] = await Promise.all([
    prisma.dailyRouteEntry.findMany({
      where: { routeId, entryDate: { gte: start, lt: end } },
      include: { lines: { include: { productEntries: true } } },
    }),
    prisma.monthlyRouteCustomerSequence.findMany({
      where: { routeId, sequenceMonth: billingMonth },
    }),
  ]);

  const rows: string[] = [];
  let lineCount = 0;
  let productEntryCount = 0;

  entries.forEach((entry) => {
    const { lines, ...entryData } = entry;
    rows.push(JSON.stringify({ table: "DailyRouteEntry", data: entryData }));

    lines.forEach((line) => {
      const { productEntries, ...lineData } = line;
      rows.push(JSON.stringify({ table: "DailyRouteEntryLine", data: lineData }));
      lineCount += 1;

      productEntries.forEach((productEntry) => {
        rows.push(JSON.stringify({ table: "DailyRouteEntryLineProduct", data: productEntry }));
        productEntryCount += 1;
      });
    });
  });

  sequences.forEach((sequence) => {
    rows.push(JSON.stringify({ table: "MonthlyRouteCustomerSequence", data: sequence }));
  });

  const jsonl = rows.join("\n");
  const checksum = createHash("sha256").update(jsonl, "utf-8").digest("hex");
  const buffer = gzipSync(Buffer.from(jsonl, "utf-8"));

  return {
    buffer,
    checksum,
    entryCount: entries.length,
    lineCount,
    productEntryCount,
    sequenceCount: sequences.length,
  };
}
