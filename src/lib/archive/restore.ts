import "server-only";
import { prisma } from "@/lib/prisma";
import { getArchiveStorage } from "@/lib/archive/storage";
import { parseArchiveBuffer } from "@/lib/archive/parse";
import { existingBillingKeys, resolveRestoredSequenceFlags } from "@/lib/archive/restore-sequences";

export type RestoreResult = { ok: true } | { ok: false; reason: string };

// Re-inserts a previously-deleted archive's rows back into Postgres, using
// their original UUIDs — safe to reuse, since nothing else could have taken
// them after they were deleted (see memory: daily-entry-archival-plan). Only
// operates on an archive in DELETED status; re-checks the checksum against
// what's recorded on the DailyEntryArchive row before touching the
// database, rather than trusting the downloaded file blindly.
export async function restoreArchive(archiveId: string): Promise<RestoreResult> {
  const archive = await prisma.dailyEntryArchive.findUnique({ where: { id: archiveId } });

  if (!archive) {
    return { ok: false, reason: "Archive record not found." };
  }

  if (archive.status !== "DELETED") {
    return { ok: false, reason: `Archive is in status ${archive.status}, not DELETED — nothing to restore.` };
  }

  const storage = getArchiveStorage();
  let downloaded: Buffer;
  try {
    downloaded = await storage.getObject(archive.storageKey);
  } catch (error) {
    return {
      ok: false,
      reason: `Could not download the archive file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let parsed;
  try {
    parsed = parseArchiveBuffer(downloaded);
  } catch (error) {
    return {
      ok: false,
      reason: `Archive file could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (parsed.checksum !== archive.checksum) {
    return { ok: false, reason: "Checksum mismatch — the archive file doesn't match what was recorded at export time." };
  }

  await prisma.$transaction(async (tx) => {
    if (parsed.entries.length > 0) {
      await tx.dailyRouteEntry.createMany({ data: parsed.entries as never[] });
    }
    if (parsed.lines.length > 0) {
      await tx.dailyRouteEntryLine.createMany({ data: parsed.lines as never[] });
    }
    if (parsed.productEntries.length > 0) {
      await tx.dailyRouteEntryLineProduct.createMany({ data: parsed.productEntries as never[] });
    }
    if (parsed.sequences.length > 0) {
      // Not createMany: at most one ACTIVE row per customer+month may carry
      // billsHere (partial unique index), and an archive can easily contain
      // several routes for one customer — or predate the column entirely, in
      // which case every row defaults to true. Either would abort the restore.
      // See resolveRestoredSequenceFlags for why rows are kept rather than
      // dropped when they can't hold the flag.
      const customerIds = [
        ...new Set(
          parsed.sequences
            .map((row) => row.customerId)
            .filter((value): value is string => typeof value === "string"),
        ),
      ];

      const alreadyBilling =
        customerIds.length > 0
          ? await tx.monthlyRouteCustomerSequence.findMany({
              where: { customerId: { in: customerIds }, status: "ACTIVE", billsHere: true },
              select: { customerId: true, sequenceMonth: true },
            })
          : [];

      const sequences = resolveRestoredSequenceFlags(parsed.sequences, existingBillingKeys(alreadyBilling));

      // One at a time so each row's resolved flag is applied — createMany
      // would take the archived values verbatim.
      for (const sequence of sequences) {
        await tx.monthlyRouteCustomerSequence.create({ data: sequence as never });
      }
    }

    await tx.dailyEntryArchive.update({
      where: { id: archive.id },
      data: { status: "RESTORED", restoredAt: new Date() },
    });
  });

  return { ok: true };
}
