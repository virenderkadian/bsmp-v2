import type { BusinessProfile } from "@prisma/client";
import { withDbTimeout } from "@/lib/db-timeout";
import { prisma } from "@/lib/prisma";
import { getEligibleArchiveCandidates, type ArchiveCandidate } from "@/lib/archive/eligibility";
import { isArchiveStorageConfigured } from "@/lib/archive/storage";

export type BusinessProfilePayload = {
  dbConnected: boolean;
  profile: BusinessProfile | null;
  error?: string;
};

export async function getBusinessProfile(cityId: string): Promise<BusinessProfilePayload> {
  try {
    const profile = await withDbTimeout(
      prisma.businessProfile.findUnique({ where: { cityId } }),
      "Business profile request",
    );

    return { dbConnected: true, profile };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load business profile.";

    return { dbConnected: false, profile: null, error: message };
  }
}

export type CityRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type CitiesPayload = {
  dbConnected: boolean;
  cities: CityRecord[];
  error?: string;
};

export async function getCitiesPayload(): Promise<CitiesPayload> {
  try {
    const cities = await withDbTimeout(
      prisma.city.findMany({
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true, isActive: true },
      }),
      "Cities request",
    );

    return { dbConnected: true, cities };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load cities.";

    return { dbConnected: false, cities: [], error: message };
  }
}

export type UserRecord = {
  id: string;
  fullName: string;
  email: string;
  role: "SUPERADMIN" | "ADMIN" | "USER";
  isActive: boolean;
  cityIds: string[];
};

export type UsersPayload = {
  dbConnected: boolean;
  users: UserRecord[];
  error?: string;
};

export type AuditLogRecord = {
  id: string;
  cityId: string | null;
  cityName: string | null;
  actorName: string;
  actorRole: string;
  entityType: string;
  entityId: string | null;
  action: string;
  summary: string;
  createdAt: string;
};

export type AuditLogsPayload = {
  dbConnected: boolean;
  logs: AuditLogRecord[];
  error?: string;
};

// Read-rarely by design (superadmin only, opened when investigating a
// discrepancy) — a bounded "most recent N" list with client-side filtering
// is enough; no need for server-side pagination for a table nobody scrolls
// through routinely.
const AUDIT_LOG_LIMIT = 300;

export async function getAuditLogsPayload(): Promise<AuditLogsPayload> {
  try {
    const logs = await withDbTimeout(
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: AUDIT_LOG_LIMIT,
        select: {
          id: true,
          cityId: true,
          city: { select: { name: true } },
          actorName: true,
          actorRole: true,
          entityType: true,
          entityId: true,
          action: true,
          summary: true,
          createdAt: true,
        },
      }),
      "Audit log request",
    );

    return {
      dbConnected: true,
      logs: logs.map((log) => ({
        id: log.id,
        cityId: log.cityId,
        cityName: log.city?.name ?? null,
        actorName: log.actorName,
        actorRole: log.actorRole,
        entityType: log.entityType,
        entityId: log.entityId,
        action: log.action,
        summary: log.summary,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load audit log.";

    return { dbConnected: false, logs: [], error: message };
  }
}

export async function getUsersPayload(): Promise<UsersPayload> {
  try {
    const users = await withDbTimeout(
      prisma.user.findMany({
        orderBy: { fullName: "asc" },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          isActive: true,
          cityAssignments: { select: { cityId: true } },
        },
      }),
      "Users request",
    );

    return {
      dbConnected: true,
      users: users.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        cityIds: user.cityAssignments.map((assignment) => assignment.cityId),
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load users.";

    return { dbConnected: false, users: [], error: message };
  }
}

export type ArchiveRecord = {
  id: string;
  cityName: string;
  routeCode: string;
  routeName: string;
  billingMonth: string;
  storageKey: string;
  entryCount: number;
  lineCount: number;
  productEntryCount: number;
  sequenceCount: number;
  status: "EXPORTED" | "DELETED" | "RESTORED";
  exportedAt: string;
  deletedAt: string | null;
  restoredAt: string | null;
};

export type ArchivePayload = {
  dbConnected: boolean;
  storageConfigured: boolean;
  candidates: ArchiveCandidate[];
  records: ArchiveRecord[];
  error?: string;
};

export async function getArchivePayload(): Promise<ArchivePayload> {
  const storageConfigured = isArchiveStorageConfigured();

  try {
    const [candidates, records] = await withDbTimeout(
      Promise.all([
        getEligibleArchiveCandidates(),
        prisma.dailyEntryArchive.findMany({
          orderBy: { exportedAt: "desc" },
          select: {
            id: true,
            billingMonth: true,
            storageKey: true,
            entryCount: true,
            lineCount: true,
            productEntryCount: true,
            sequenceCount: true,
            status: true,
            exportedAt: true,
            deletedAt: true,
            restoredAt: true,
            city: { select: { name: true } },
            route: { select: { code: true, name: true } },
          },
        }),
      ]),
      "Archive payload request",
    );

    return {
      dbConnected: true,
      storageConfigured,
      candidates,
      records: records.map((record) => ({
        id: record.id,
        cityName: record.city.name,
        routeCode: record.route.code,
        routeName: record.route.name,
        billingMonth: record.billingMonth.toISOString().slice(0, 7),
        storageKey: record.storageKey,
        entryCount: record.entryCount,
        lineCount: record.lineCount,
        productEntryCount: record.productEntryCount,
        sequenceCount: record.sequenceCount,
        status: record.status,
        exportedAt: record.exportedAt.toISOString(),
        deletedAt: record.deletedAt?.toISOString() ?? null,
        restoredAt: record.restoredAt?.toISOString() ?? null,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load archive data.";

    return { dbConnected: false, storageConfigured, candidates: [], records: [], error: message };
  }
}
