"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperadmin } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { buildArchiveExport, archiveStorageKey } from "@/lib/archive/export";
import { verifyArchiveExport } from "@/lib/archive/verify";
import { getArchiveStorage, ArchiveStorageNotConfiguredError } from "@/lib/archive/storage";
import { deleteArchivedRows } from "@/lib/archive/delete";
import { restoreArchive } from "@/lib/archive/restore";

export type ArchiveActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const idleState: ArchiveActionState = { status: "idle" };

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getErrorMessage(error: unknown) {
  if (error instanceof ArchiveStorageNotConfiguredError) {
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

function revalidateArchive() {
  revalidatePath("/settings");
}

const exportSchema = z.object({
  routeId: z.string().trim().min(1),
  billingMonth: z.string().trim().regex(/^\d{4}-\d{2}$/),
  cityId: z.string().trim().min(1),
  cityCode: z.string().trim().min(1),
  routeCode: z.string().trim().min(1),
});

// Step 1: export this route/month's daily-entry data to R2, then
// immediately re-download and re-verify it before recording anything as
// EXPORTED. Never deletes anything from Postgres — that's a separate,
// explicit confirmation step (confirmArchiveDelete).
export async function runArchiveExport(
  _prevState: ArchiveActionState = idleState,
  formData: FormData,
): Promise<ArchiveActionState> {
  void _prevState;

  const parsed = exportSchema.safeParse({
    routeId: getValue(formData, "routeId"),
    billingMonth: getValue(formData, "billingMonth"),
    cityId: getValue(formData, "cityId"),
    cityCode: getValue(formData, "cityCode"),
    routeCode: getValue(formData, "routeCode"),
  });

  if (!parsed.success) {
    return { status: "error", message: "Invalid archive request." };
  }

  try {
    await requireSuperadmin();

    const billingMonthDate = new Date(`${parsed.data.billingMonth}-01T00:00:00.000Z`);
    const storageKey = archiveStorageKey(parsed.data.cityCode, parsed.data.routeCode, billingMonthDate);

    const exportResult = await buildArchiveExport(parsed.data.routeId, billingMonthDate);

    if (exportResult.entryCount === 0) {
      return { status: "error", message: "No daily entries found for this route/month — nothing to archive." };
    }

    const storage = getArchiveStorage();
    await storage.putObject(storageKey, exportResult.buffer, "application/gzip");

    const verifyResult = await verifyArchiveExport(storageKey, {
      checksum: exportResult.checksum,
      entryCount: exportResult.entryCount,
      lineCount: exportResult.lineCount,
      productEntryCount: exportResult.productEntryCount,
      sequenceCount: exportResult.sequenceCount,
    });

    if (!verifyResult.ok) {
      return {
        status: "error",
        message: `Export uploaded but failed verification — nothing was recorded as archived. ${verifyResult.reason}`,
      };
    }

    const archive = await prisma.dailyEntryArchive.create({
      data: {
        cityId: parsed.data.cityId,
        routeId: parsed.data.routeId,
        billingMonth: billingMonthDate,
        storageKey,
        checksum: exportResult.checksum,
        entryCount: exportResult.entryCount,
        lineCount: exportResult.lineCount,
        productEntryCount: exportResult.productEntryCount,
        sequenceCount: exportResult.sequenceCount,
        status: "EXPORTED",
      },
    });

    await logAudit(prisma, {
      cityId: parsed.data.cityId,
      entityType: "DailyEntryArchive",
      entityId: archive.id,
      action: "EXPORT",
      summary: `Exported and verified ${exportResult.entryCount} daily entries for route ${parsed.data.routeCode}, ${parsed.data.billingMonth} to ${storageKey}.`,
      after: exportResult,
    });

    revalidateArchive();
    return {
      status: "success",
      message: `Exported and verified ${exportResult.entryCount} daily entries. Review, then confirm delete to free up database space.`,
    };
  } catch (error) {
    return { status: "error", message: getErrorMessage(error) };
  }
}

const idSchema = z.object({ id: z.string().trim().min(1) });

// Step 2: only runs against an archive already in EXPORTED status, and
// re-verifies the file in storage one more time immediately before
// deleting anything (see src/lib/archive/delete.ts). A separate, deliberate
// action from export — never auto-chained.
export async function confirmArchiveDelete(
  _prevState: ArchiveActionState = idleState,
  formData: FormData,
): Promise<ArchiveActionState> {
  void _prevState;

  const parsed = idSchema.safeParse({ id: getValue(formData, "id") });
  if (!parsed.success) {
    return { status: "error", message: "Invalid archive id." };
  }

  try {
    await requireSuperadmin();

    const archive = await prisma.dailyEntryArchive.findUnique({ where: { id: parsed.data.id } });
    if (!archive) {
      return { status: "error", message: "Archive record not found." };
    }

    const result = await deleteArchivedRows(parsed.data.id);

    if (!result.ok) {
      await logAudit(prisma, {
        cityId: archive.cityId,
        entityType: "DailyEntryArchive",
        entityId: archive.id,
        action: "DELETE_BLOCKED",
        summary: `Refused to delete archived rows for archive ${archive.id}: ${result.reason}`,
      });
      return { status: "error", message: result.reason };
    }

    await logAudit(prisma, {
      cityId: archive.cityId,
      entityType: "DailyEntryArchive",
      entityId: archive.id,
      action: "DELETE",
      summary: `Deleted ${archive.entryCount} archived daily entries from Postgres for route/month (storage key ${archive.storageKey}).`,
    });

    revalidateArchive();
    return { status: "success", message: "Archived rows deleted from the database." };
  } catch (error) {
    return { status: "error", message: getErrorMessage(error) };
  }
}

// Restores a DELETED archive's rows back into Postgres from R2, keyed on
// their original UUIDs. Superadmin-only, same as the rest of this file.
export async function restoreArchiveAction(
  _prevState: ArchiveActionState = idleState,
  formData: FormData,
): Promise<ArchiveActionState> {
  void _prevState;

  const parsed = idSchema.safeParse({ id: getValue(formData, "id") });
  if (!parsed.success) {
    return { status: "error", message: "Invalid archive id." };
  }

  try {
    await requireSuperadmin();

    const archive = await prisma.dailyEntryArchive.findUnique({ where: { id: parsed.data.id } });
    if (!archive) {
      return { status: "error", message: "Archive record not found." };
    }

    const result = await restoreArchive(parsed.data.id);

    if (!result.ok) {
      return { status: "error", message: result.reason };
    }

    await logAudit(prisma, {
      cityId: archive.cityId,
      entityType: "DailyEntryArchive",
      entityId: archive.id,
      action: "RESTORE",
      summary: `Restored ${archive.entryCount} archived daily entries back into Postgres from ${archive.storageKey}.`,
    });

    revalidateArchive();
    return { status: "success", message: "Archived rows restored." };
  } catch (error) {
    return { status: "error", message: getErrorMessage(error) };
  }
}
