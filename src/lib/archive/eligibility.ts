import "server-only";
import { prisma } from "@/lib/prisma";

// Not a pure calendar cutoff — tied to the actual business event that makes
// the data safe to move (see memory: daily-entry-archival-plan). A route's
// month becomes archivable once every bill for it is LOCKED, with a grace
// buffer in case someone unlocks/regenerates shortly after locking.
export const ARCHIVE_GRACE_PERIOD_DAYS = 60;

export type ArchiveCandidate = {
  cityId: string;
  cityCode: string;
  cityName: string;
  routeId: string;
  routeCode: string;
  routeName: string;
  billingMonth: Date;
  billCount: number;
  lockedDaysAgo: number;
  entryCount: number;
};

function monthKey(routeId: string, billingMonth: Date) {
  return `${routeId}:${billingMonth.toISOString()}`;
}

export async function getEligibleArchiveCandidates(): Promise<ArchiveCandidate[]> {
  const [bills, alreadyArchived] = await Promise.all([
    prisma.monthlyBill.findMany({
      select: {
        routeId: true,
        billingMonth: true,
        status: true,
        updatedAt: true,
        route: { select: { code: true, name: true, cityId: true, city: { select: { code: true, name: true } } } },
      },
    }),
    prisma.dailyEntryArchive.findMany({ select: { routeId: true, billingMonth: true } }),
  ]);

  const archivedKeys = new Set(alreadyArchived.map((a) => monthKey(a.routeId, a.billingMonth)));

  const groups = new Map<
    string,
    {
      routeId: string;
      routeCode: string;
      routeName: string;
      cityId: string;
      cityCode: string;
      cityName: string;
      billingMonth: Date;
      statuses: string[];
      maxUpdatedAt: Date;
    }
  >();

  bills.forEach((bill) => {
    const key = monthKey(bill.routeId, bill.billingMonth);
    const existing = groups.get(key);

    if (existing) {
      existing.statuses.push(bill.status);
      if (bill.updatedAt > existing.maxUpdatedAt) {
        existing.maxUpdatedAt = bill.updatedAt;
      }
      return;
    }

    groups.set(key, {
      routeId: bill.routeId,
      routeCode: bill.route.code,
      routeName: bill.route.name,
      cityId: bill.route.cityId,
      cityCode: bill.route.city.code,
      cityName: bill.route.city.name,
      billingMonth: bill.billingMonth,
      statuses: [bill.status],
      maxUpdatedAt: bill.updatedAt,
    });
  });

  const now = Date.now();
  const eligibleGroups = Array.from(groups.entries()).filter(([key, group]) => {
    if (archivedKeys.has(key)) {
      return false;
    }

    const allLocked = group.statuses.every((status) => status === "LOCKED");
    if (!allLocked) {
      return false;
    }

    const daysSinceLock = (now - group.maxUpdatedAt.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceLock >= ARCHIVE_GRACE_PERIOD_DAYS;
  });

  const entryCounts = await Promise.all(
    eligibleGroups.map(([, group]) => {
      const start = group.billingMonth;
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);

      return prisma.dailyRouteEntry.count({
        where: { routeId: group.routeId, entryDate: { gte: start, lt: end } },
      });
    }),
  );

  return eligibleGroups
    .map(([, group], index) => ({
      cityId: group.cityId,
      cityCode: group.cityCode,
      cityName: group.cityName,
      routeId: group.routeId,
      routeCode: group.routeCode,
      routeName: group.routeName,
      billingMonth: group.billingMonth,
      billCount: group.statuses.length,
      lockedDaysAgo: Math.floor((now - group.maxUpdatedAt.getTime()) / (1000 * 60 * 60 * 24)),
      entryCount: entryCounts[index],
    }))
    .filter((candidate) => candidate.entryCount > 0)
    .sort((a, b) => a.billingMonth.getTime() - b.billingMonth.getTime());
}
