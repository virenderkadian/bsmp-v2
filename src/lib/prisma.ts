import { PrismaClient } from "@prisma/client";
import { getCityContext } from "@/lib/city-context";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

// Models that carry a direct cityId column and are worked with one city at a
// time on every operational screen (Daily Entry, Payments, Reconciliation,
// Masters). This is a backstop, not the primary defense — every action file
// already scopes its own queries explicitly via getCurrentCityId(). This
// guard exists to catch the case where a query against one of these models
// *forgets* that where clause: it never widens a query, only narrows one,
// and only when the caller hasn't already specified cityId itself (so
// deliberate cross-city use — e.g. a maintenance script — still works).
// Deliberately excludes UserCityAssignment: city/team management is
// inherently cross-city for superadmins (src/app/settings/user-actions.ts
// already manages it correctly across every city a user is assigned to).
const CITY_SCOPED_MODELS = new Set(["Vehicle", "Product", "Route", "Customer", "BusinessProfile"]);

const CITY_SCOPED_OPERATIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
  "upsert",
]);

function withCityScope(args: Record<string, unknown>, cityId: string) {
  const where = args.where;

  if (where && typeof where === "object" && "cityId" in where) {
    return args;
  }

  return { ...args, where: { ...(where as object | undefined), cityId } };
}

function getDatasourceUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return undefined;
  }

  try {
    const url = new URL(databaseUrl);

    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", "10");
    }

    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", "20");
    }

    return url.toString();
  } catch {
    return databaseUrl;
  }
}

const datasourceUrl = getDatasourceUrl();

const baseClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(datasourceUrl ? { datasourceUrl } : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

globalForPrisma.prisma = baseClient;

export const prisma = baseClient.$extends({
  name: "city-scope-guard",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!model || !CITY_SCOPED_MODELS.has(model) || !CITY_SCOPED_OPERATIONS.has(operation)) {
          return query(args);
        }

        const cityId = getCityContext();

        if (!cityId) {
          return query(args);
        }

        return query(withCityScope(args as Record<string, unknown>, cityId));
      },
    },
  },
});
