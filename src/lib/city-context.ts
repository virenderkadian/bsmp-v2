import { AsyncLocalStorage } from "node:async_hooks";

// Deliberately dependency-free (no Prisma, no next/headers) so both
// src/lib/prisma.ts (the query guard) and src/lib/current-city.ts (the
// resolver) can import from here without creating a circular import between
// the two. AsyncLocalStorage scopes the value to the current request's async
// call chain only — unlike a Postgres session variable behind a connection
// pooler, there's no risk of one request's city leaking into another's.
const cityContext = new AsyncLocalStorage<string>();

export function setCityContext(cityId: string) {
  cityContext.enterWith(cityId);
}

export function getCityContext(): string | undefined {
  return cityContext.getStore();
}
