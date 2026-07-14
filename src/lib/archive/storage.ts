import "server-only";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Storage is behind this interface deliberately — the rest of the archive
// pipeline (export/verify/delete/restore) never talks to R2 or the AWS SDK
// directly, only to this. Swapping providers, or unit-testing the pipeline
// against an in-memory fake, never needs to touch those files.
export type ArchiveStorage = {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<Buffer>;
};

export class ArchiveStorageNotConfiguredError extends Error {
  constructor() {
    super(
      "Archive storage isn't configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME in .env before running an archive export.",
    );
    this.name = "ArchiveStorageNotConfiguredError";
  }
}

class R2ArchiveStorage implements ArchiveStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async putObject(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getObject(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));

    if (!result.Body) {
      throw new Error(`Archive object "${key}" returned no body from storage.`);
    }

    const bytes = await result.Body.transformToByteArray();
    return Buffer.from(bytes);
  }
}

let cached: ArchiveStorage | null = null;

// R2 is S3-compatible, so the AWS SDK talks to it directly against R2's own
// endpoint — no separate Cloudflare-specific client needed. Region is
// always "auto" for R2 regardless of where the bucket actually lives.
export function getArchiveStorage(): ArchiveStorage {
  if (cached) {
    return cached;
  }

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new ArchiveStorageNotConfiguredError();
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  cached = new R2ArchiveStorage(client, bucket);
  return cached;
}

export function isArchiveStorageConfigured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME,
  );
}
