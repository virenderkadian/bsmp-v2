import "server-only";
import { prisma } from "@/lib/prisma";
import { monthBounds } from "@/lib/archive/export";
import { verifyArchiveExport } from "@/lib/archive/verify";

export type DeleteResult = { ok: true } | { ok: false; reason: string };

// Deletes the Postgres rows for an already-exported, already-verified
// archive — and re-verifies one more time immediately before doing it,
// since time may have passed (minutes to days) between the original
// export+verify and a human confirming the delete step. Cheap insurance:
// this only re-downloads and re-checks, it doesn't re-export.
export async function deleteArchivedRows(archiveId: string): Promise<DeleteResult> {
  const archive = await prisma.dailyEntryArchive.findUnique({ where: { id: archiveId } });

  if (!archive) {
    return { ok: false, reason: "Archive record not found." };
  }

  if (archive.status !== "EXPORTED") {
    return { ok: false, reason: `Archive is in status ${archive.status}, not EXPORTED — refusing to delete.` };
  }

  const reverify = await verifyArchiveExport(archive.storageKey, {
    checksum: archive.checksum,
    entryCount: archive.entryCount,
    lineCount: archive.lineCount,
    productEntryCount: archive.productEntryCount,
    sequenceCount: archive.sequenceCount,
  });

  if (!reverify.ok) {
    return { ok: false, reason: `Re-verification before delete failed: ${reverify.reason}` };
  }

  const { start, end } = monthBounds(archive.billingMonth);

  // One more guard: the live row counts right now must match exactly what
  // was archived. If they don't — e.g. something touched this "locked"
  // month's data between export and this delete confirmation — abort
  // rather than deleting a dataset that no longer matches what was
  // verified.
  const [liveEntryCount, liveSequenceCount] = await Promise.all([
    prisma.dailyRouteEntry.count({ where: { routeId: archive.routeId, entryDate: { gte: start, lt: end } } }),
    prisma.monthlyRouteCustomerSequence.count({
      where: { routeId: archive.routeId, sequenceMonth: archive.billingMonth },
    }),
  ]);

  if (liveEntryCount !== archive.entryCount || liveSequenceCount !== archive.sequenceCount) {
    return {
      ok: false,
      reason: `Live row counts no longer match the archived export (entries ${liveEntryCount} vs ${archive.entryCount}, sequences ${liveSequenceCount} vs ${archive.sequenceCount}) — refusing to delete.`,
    };
  }

  await prisma.$transaction(async (tx) => {
    const entries = await tx.dailyRouteEntry.findMany({
      where: { routeId: archive.routeId, entryDate: { gte: start, lt: end } },
      select: { id: true, lines: { select: { id: true } } },
    });
    const lineIds = entries.flatMap((entry) => entry.lines.map((line) => line.id));

    await tx.dailyRouteEntryLineProduct.deleteMany({ where: { lineId: { in: lineIds } } });
    await tx.dailyRouteEntryLine.deleteMany({ where: { entryId: { in: entries.map((e) => e.id) } } });
    await tx.dailyRouteEntry.deleteMany({ where: { id: { in: entries.map((e) => e.id) } } });
    await tx.monthlyRouteCustomerSequence.deleteMany({
      where: { routeId: archive.routeId, sequenceMonth: archive.billingMonth },
    });

    await tx.dailyEntryArchive.update({
      where: { id: archive.id },
      data: { status: "DELETED", deletedAt: new Date() },
    });
  });

  // VACUUM cannot run inside a transaction block, and deliberately isn't
  // VACUUM FULL — FULL takes an exclusive table lock, which would block
  // live Daily Entry saves on every other route/month while it runs. Plain
  // VACUUM is non-blocking and reclaims the space for Postgres to reuse on
  // future inserts, even though it doesn't shrink the file on disk
  // immediately.
  await prisma.$executeRawUnsafe(
    `VACUUM "DailyRouteEntry", "DailyRouteEntryLine", "DailyRouteEntryLineProduct", "MonthlyRouteCustomerSequence"`,
  );

  return { ok: true };
}
