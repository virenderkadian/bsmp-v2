import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

export type ParsedArchive = {
  jsonl: string;
  checksum: string;
  entries: Array<Record<string, unknown>>;
  lines: Array<Record<string, unknown>>;
  productEntries: Array<Record<string, unknown>>;
  sequences: Array<Record<string, unknown>>;
};

// Shared by both verify (re-check counts/checksum before allowing a delete)
// and restore (re-insert into Postgres) — one parser, one place a bug in
// reading the format back would surface, instead of two.
export function parseArchiveBuffer(gzipBuffer: Buffer): ParsedArchive {
  const jsonl = gunzipSync(gzipBuffer).toString("utf-8");
  const checksum = createHash("sha256").update(jsonl, "utf-8").digest("hex");

  const entries: Array<Record<string, unknown>> = [];
  const lines: Array<Record<string, unknown>> = [];
  const productEntries: Array<Record<string, unknown>> = [];
  const sequences: Array<Record<string, unknown>> = [];

  jsonl
    .split("\n")
    .filter((row) => row.trim().length > 0)
    .forEach((row) => {
      const parsed = JSON.parse(row) as { table: string; data: Record<string, unknown> };

      switch (parsed.table) {
        case "DailyRouteEntry":
          entries.push(parsed.data);
          break;
        case "DailyRouteEntryLine":
          lines.push(parsed.data);
          break;
        case "DailyRouteEntryLineProduct":
          productEntries.push(parsed.data);
          break;
        case "MonthlyRouteCustomerSequence":
          sequences.push(parsed.data);
          break;
        default:
          throw new Error(`Unknown table tag "${parsed.table}" in archive file.`);
      }
    });

  return { jsonl, checksum, entries, lines, productEntries, sequences };
}
