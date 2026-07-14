import "server-only";
import { getArchiveStorage } from "@/lib/archive/storage";
import { parseArchiveBuffer } from "@/lib/archive/parse";

export type VerifyResult = { ok: true } | { ok: false; reason: string };

// Only what verification actually checks — decoupled from
// ArchiveExportResult's `buffer` field, which matters only to the original
// export/upload step, not to re-checking a file already in storage.
export type ArchiveExpectedCounts = {
  checksum: string;
  entryCount: number;
  lineCount: number;
  productEntryCount: number;
  sequenceCount: number;
};

// The hard precondition for ever deleting anything from Postgres: download
// what was just written to R2 (not trust the local buffer that produced
// it), decompress and reparse it, and confirm both the checksum and every
// row count match what was exported. If this fails for any reason —
// network error, corrupt upload, parse failure, any mismatch — the delete
// step must never run. See src/lib/archive/delete.ts, which only accepts a
// DailyEntryArchive row already in EXPORTED status as its input, and that
// status is only ever set after this function returns ok: true.
export async function verifyArchiveExport(
  storageKey: string,
  expected: ArchiveExpectedCounts,
): Promise<VerifyResult> {
  const storage = getArchiveStorage();

  let downloaded: Buffer;
  try {
    downloaded = await storage.getObject(storageKey);
  } catch (error) {
    return {
      ok: false,
      reason: `Could not re-download the export from storage: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let parsed;
  try {
    parsed = parseArchiveBuffer(downloaded);
  } catch (error) {
    return {
      ok: false,
      reason: `Downloaded archive file could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (parsed.checksum !== expected.checksum) {
    return { ok: false, reason: "Checksum mismatch between the exported data and what was read back from storage." };
  }

  if (parsed.entries.length !== expected.entryCount) {
    return {
      ok: false,
      reason: `Entry count mismatch: expected ${expected.entryCount}, found ${parsed.entries.length}.`,
    };
  }

  if (parsed.lines.length !== expected.lineCount) {
    return { ok: false, reason: `Line count mismatch: expected ${expected.lineCount}, found ${parsed.lines.length}.` };
  }

  if (parsed.productEntries.length !== expected.productEntryCount) {
    return {
      ok: false,
      reason: `Product entry count mismatch: expected ${expected.productEntryCount}, found ${parsed.productEntries.length}.`,
    };
  }

  if (parsed.sequences.length !== expected.sequenceCount) {
    return {
      ok: false,
      reason: `Sequence count mismatch: expected ${expected.sequenceCount}, found ${parsed.sequences.length}.`,
    };
  }

  return { ok: true };
}
