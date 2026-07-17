"use client";

import { useRef } from "react";
import { SecondaryButton } from "@/components/admin/buttons";
import type { DailyEntryRouteOption } from "@/lib/daily-entry";

// Auto-submits on date/route change instead of requiring an explicit
// "Reload" click. Save All (in the page header, outside this form) submits
// a *different* form whose entryDate is a hidden field frozen to whatever
// was last loaded here — if a user could change this picker, leave the
// stale sequence on screen, and hit Save without reloading, the save would
// silently land on the wrong date and overwrite whatever was already there
// (upsert is keyed on route+date). Auto-submitting closes that window
// entirely: changing either field immediately reloads, so the hidden field
// backing Save can never go stale.
export function DailyEntryToolbar({
  selectedDate,
  selectedRouteId,
  routes,
}: {
  selectedDate: string;
  selectedRouteId: string;
  routes: DailyEntryRouteOption[];
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action="/daily-entry" className="flex flex-wrap items-center gap-3">
      <input
        name="entryDate"
        type="date"
        defaultValue={selectedDate}
        onChange={() => formRef.current?.requestSubmit()}
        className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
      />
      <select
        name="routeId"
        defaultValue={selectedRouteId}
        onChange={() => formRef.current?.requestSubmit()}
        className="h-10 min-w-72 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
      >
        {routes.length === 0 ? (
          <option value="">Select route</option>
        ) : (
          routes.map((route) => (
            <option key={route.id} value={route.id}>
              {route.name}
            </option>
          ))
        )}
      </select>
      <SecondaryButton type="submit" className="h-10 rounded-md px-4 text-sm font-semibold">
        Reload
      </SecondaryButton>
    </form>
  );
}
