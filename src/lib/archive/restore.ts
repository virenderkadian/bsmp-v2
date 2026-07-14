import "server-only";
import { prisma } from "@/lib/prisma";
import { getArchiveStorage } from "@/lib/archive/storage";
import { parseArchiveBuffer } from "@/lib/archive/parse";

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
      await tx.monthlyRouteCustomerSequence.createMany({ data: parsed.sequences as never[] });
    }

    await tx.dailyEntryArchive.update({
      where: { id: archive.id },
      data: { status: "RESTORED", restoredAt: new Date() },
    });
  });

  return { ok: true };
}
