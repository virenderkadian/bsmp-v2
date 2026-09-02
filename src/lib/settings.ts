import type { BusinessProfile } from "@prisma/client";
import { getCurrentCityId } from "@/lib/current-city";
import { withDbTimeout } from "@/lib/db-timeout";
import { monthInputToDate } from "@/lib/monthly-route-sequence";
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
  // Summary with any raw UUIDs swapped for something readable — see
  // resolveSummaryIds. Kept alongside the original so nothing is lost.
  summaryLabel: string;
  before: unknown;
  after: unknown;
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

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Audit summaries are written as free text and several embed a raw id, e.g.
// "Saved daily entry for route 2d63fc67-...". Unreadable in the Activity list,
// and there's no fixing it at the point of writing for entries already stored.
//
// So ids are resolved when the log is READ: every UUID appearing in any summary
// is looked up once across the tables that could own it, and swapped for
// something recognisable. Unknown ids (deleted rows, ids of other kinds) are
// left exactly as they are rather than guessed at.
async function resolveSummaryIds(summaries: string[]): Promise<Map<string, string>> {
  const ids = new Set<string>();
  summaries.forEach((summary) => {
    const matches = summary.match(UUID_PATTERN);
    matches?.forEach((match) => ids.add(match.toLowerCase()));
  });

  if (ids.size === 0) {
    return new Map();
  }

  const idList = [...ids];
  const [routes, customers, vehicles] = await Promise.all([
    prisma.route.findMany({ where: { id: { in: idList } }, select: { id: true, code: true, name: true } }),
    prisma.customer.findMany({ where: { id: { in: idList } }, select: { id: true, code: true, name: true } }),
    prisma.vehicle.findMany({ where: { id: { in: idList } }, select: { id: true, code: true, name: true } }),
  ]);

  const labels = new Map<string, string>();
  routes.forEach((route) => labels.set(route.id.toLowerCase(), `${route.code} (${route.name})`));
  customers.forEach((customer) => labels.set(customer.id.toLowerCase(), `${customer.code} (${customer.name})`));
  vehicles.forEach((vehicle) => labels.set(vehicle.id.toLowerCase(), `${vehicle.code} (${vehicle.name})`));

  return labels;
}

function applySummaryLabels(summary: string, labels: Map<string, string>): string {
  return summary.replace(UUID_PATTERN, (match) => labels.get(match.toLowerCase()) ?? match);
}

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
          before: true,
          after: true,
          createdAt: true,
        },
      }),
      "Audit log request",
    );

    const labelById = await resolveSummaryIds(logs.map((log) => log.summary));

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
        summaryLabel: applySummaryLabels(log.summary, labelById),
        before: log.before ?? null,
        after: log.after ?? null,
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

export type BillingRouteCustomerRoute = {
  routeId: string;
  routeCode: string;
  routeName: string;
  shift: string;
  billsHere: boolean;
};

export type BillingRouteCustomer = {
  customerId: string;
  customerCode: string;
  customerName: string;
  sequenceMonth: string;
  routes: BillingRouteCustomerRoute[];
  // True when no route is flagged, so the bill silently falls back to the
  // earliest route. Nothing is broken — the customer still gets exactly one
  // bill — but nobody chose where, which is worth surfacing.
  unassigned: boolean;
};

export type BillingRoutesPayload = {
  dbConnected: boolean;
  customers: BillingRouteCustomer[];
  // The month being viewed, and every month that has any multi-route customer
  // to look at, so the picker offers real choices rather than a blank calendar.
  selectedMonth: string;
  availableMonths: string[];
  // Past months are readable but not editable — see the note on the loader.
  readOnly: boolean;
  error?: string;
};

// Customers running more than one route in a month, with the route that
// carries their single combined bill. This is the review queue for decisions
// made in the add-to-sequence dialog — and for the ones that predate it, where
// the migration picked the earliest route on their behalf.
//
// Editing is limited to the current month and later: a past month is already
// billed, and moving where its bill sits would rewrite history rather than fix
// anything. VIEWING is not limited — being unable to see which route carried a
// customer's bill in June is just a blind spot, so older months load read-only.
export async function getBillingRoutesPayload(input?: {
  month?: string;
}): Promise<BillingRoutesPayload> {
  const now = new Date();
  const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const currentMonthKey = currentMonth.toISOString().slice(0, 7);
  const selectedMonth =
    input?.month && /^\d{4}-\d{2}$/.test(input.month) ? input.month : currentMonthKey;
  const readOnly = selectedMonth < currentMonthKey;

  try {
    const cityId = await getCurrentCityId();
    const fromMonth = monthInputToDate(selectedMonth);

    const rows = await withDbTimeout(
      prisma.monthlyRouteCustomerSequence.findMany({
        where: {
          route: { cityId },
          status: "ACTIVE",
          // A past month is shown on its own; the current month still carries
          // future ones with it, since those are all editable.
          sequenceMonth: readOnly ? fromMonth : { gte: fromMonth },
        },
        orderBy: [{ sequenceMonth: "asc" }, { createdAt: "asc" }],
        select: {
          customerId: true,
          routeId: true,
          sequenceMonth: true,
          billsHere: true,
          customer: { select: { code: true, name: true } },
          route: { select: { code: true, name: true, shift: true } },
        },
      }),
      "Billing routes request",
    );

    const grouped = new Map<string, BillingRouteCustomer>();
    for (const row of rows) {
      const monthKey = row.sequenceMonth.toISOString().slice(0, 7);
      const key = `${row.customerId}:${monthKey}`;
      const existing = grouped.get(key) ?? {
        customerId: row.customerId,
        customerCode: row.customer.code,
        customerName: row.customer.name,
        sequenceMonth: monthKey,
        routes: [],
        unassigned: false,
      };
      existing.routes.push({
        routeId: row.routeId,
        routeCode: row.route.code,
        routeName: row.route.name,
        shift: String(row.route.shift),
        billsHere: row.billsHere,
      });
      grouped.set(key, existing);
    }

    const customers = [...grouped.values()]
      // Single-route customers need no decision at all — their only route bills
      // them, and listing them would bury the ones that do need attention.
      .filter((customer) => customer.routes.length > 1)
      .map((customer) => ({
        ...customer,
        unassigned: !customer.routes.some((route) => route.billsHere),
      }))
      .sort(
        (left, right) =>
          Number(right.unassigned) - Number(left.unassigned) ||
          left.sequenceMonth.localeCompare(right.sequenceMonth) ||
          left.customerName.localeCompare(right.customerName),
      );

    // Every month that actually has a multi-route customer, so the picker
    // offers months worth opening rather than an open-ended calendar.
    const monthRows = await withDbTimeout(
      prisma.monthlyRouteCustomerSequence.groupBy({
        by: ["sequenceMonth"],
        where: { route: { cityId }, status: "ACTIVE" },
        orderBy: { sequenceMonth: "desc" },
      }),
      "Billing route months request",
    );
    const availableMonths = [
      ...new Set([
        currentMonthKey,
        ...monthRows.map((row) => row.sequenceMonth.toISOString().slice(0, 7)),
      ]),
    ].sort((left, right) => right.localeCompare(left));

    return { dbConnected: true, customers, selectedMonth, availableMonths, readOnly };
  } catch (error) {
    return {
      dbConnected: false,
      customers: [],
      selectedMonth,
      availableMonths: [currentMonthKey],
      readOnly,
      error: error instanceof Error ? error.message : "Unable to load billing routes.",
    };
  }
}
