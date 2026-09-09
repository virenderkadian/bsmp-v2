"use client";

import { EmptyState } from "@/components/admin/empty-state";
import { StatusBadge } from "@/components/admin/status-badge";
import type { DuplicateNamesPayload } from "@/lib/settings";

// A review queue, not a defect list. Several of these are genuinely different
// people who happen to share a first name — RAHUL is four of them. What matters
// is whether anything on the record tells them apart.
export function DuplicateNamesPanel({
  dbConnected,
  groups,
  unresolvableCount,
  error,
}: DuplicateNamesPayload) {
  if (!dbConnected) {
    return <EmptyState message={error ?? "Unable to load duplicate names."} />;
  }

  if (groups.length === 0) {
    return <EmptyState message="No two active customers in this city share a name." />;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-surface p-4">
        <p className="text-sm text-text-secondary">
          {groups.length} name{groups.length === 1 ? "" : "s"} shared by more than one active
          customer. Most are genuinely different people — what matters is whether the record
          says which is which.
        </p>
        {unresolvableCount > 0 ? (
          <p className="mt-2 text-sm text-amber-700">
            <strong className="font-semibold">
              {unresolvableCount} {unresolvableCount === 1 ? "record has" : "records have"} no area
            </strong>{" "}
            and share their name with someone else, so nothing on the record tells them apart.
            Those are the ones worth fixing.
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        {groups.map((group) => (
          <section key={group.name} className="rounded-lg border border-surface-border bg-surface">
            <div className="flex items-center justify-between gap-3 border-b border-surface-border px-4 py-2.5">
              <h3 className="text-sm font-semibold text-text-primary">{group.name}</h3>
              <StatusBadge tone={group.customers.some((entry) => entry.unresolvable) ? "warning" : "neutral"}>
                {group.customers.length} customers
              </StatusBadge>
            </div>
            <ul className="divide-y divide-surface-border">
              {group.customers.map((entry) => (
                <li key={entry.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                  <span className="font-medium text-text-primary">{entry.code}</span>
                  {entry.area ? (
                    <span className="text-text-secondary">{entry.area}</span>
                  ) : (
                    <span className="font-semibold text-amber-700">no area</span>
                  )}
                  <span className="text-text-muted">
                    {entry.round ? entry.round : "not on a round"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
