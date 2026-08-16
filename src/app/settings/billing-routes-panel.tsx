"use client";

import { useActionState } from "react";
import { setBillingRoute, type BillingRouteActionState } from "@/app/settings/billing-route-actions";
import { EmptyState } from "@/components/admin/empty-state";
import { StatusChip } from "@/components/admin/status-chip";
import type { BillingRouteCustomer } from "@/lib/settings";

const initialState: BillingRouteActionState = { status: "idle" };

function formatMonth(month: string) {
  const [year, monthPart] = month.split("-");
  return new Date(Date.UTC(Number(year), Number(monthPart) - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Review queue for customers running more than one route in a month. Each gets
// ONE combined bill; this is where the office confirms — or changes — which
// route it appears on.
export function BillingRoutesPanel({
  dbConnected,
  customers,
  error,
}: {
  dbConnected: boolean;
  customers: BillingRouteCustomer[];
  error?: string;
}) {
  const [state, formAction, pending] = useActionState(setBillingRoute, initialState);

  if (!dbConnected) {
    return <EmptyState message={error ?? "Unable to load billing routes."} />;
  }

  if (customers.length === 0) {
    return (
      <EmptyState message="No customer runs more than one route this month, so every bill already has exactly one home." />
    );
  }

  const unassignedCount = customers.filter((customer) => customer.unassigned).length;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-surface p-4">
        <p className="text-sm text-text-secondary">
          These customers run more than one route in a month. Each gets a{" "}
          <strong className="font-semibold text-text-primary">single combined bill</strong> covering every
          route — pick which route it appears on. The other routes still deliver to them as normal.
        </p>
        {unassignedCount > 0 ? (
          <p className="mt-2 text-sm text-amber-700">
            {unassignedCount} {unassignedCount === 1 ? "customer has" : "customers have"} no route chosen.
            They&apos;re billed on their earliest route by default — confirm or change it below.
          </p>
        ) : null}
      </div>

      {state.status !== "idle" && state.message ? (
        <p className={state.status === "error" ? "text-sm text-rose-700" : "text-sm text-emerald-700"}>
          {state.message}
        </p>
      ) : null}

      <div className="space-y-3">
        {customers.map((customer) => (
          <div
            key={`${customer.customerId}:${customer.sequenceMonth}`}
            className="rounded-lg border border-surface-border bg-surface p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-text-primary">
                  {customer.customerCode} — {customer.customerName}
                </p>
                <p className="text-xs text-text-muted">{formatMonth(customer.sequenceMonth)}</p>
              </div>
              {customer.unassigned ? <StatusChip tone="warning">Not chosen</StatusChip> : null}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {customer.routes.map((route) => (
                <form key={route.routeId} action={formAction}>
                  <input type="hidden" name="customerId" value={customer.customerId} readOnly />
                  <input type="hidden" name="sequenceMonth" value={customer.sequenceMonth} readOnly />
                  <input type="hidden" name="routeId" value={route.routeId} readOnly />
                  <button
                    type="submit"
                    disabled={pending || route.billsHere}
                    className={`rounded-md border px-3 py-2 text-left text-xs transition disabled:cursor-default ${
                      route.billsHere
                        ? "border-accent bg-accent/10 text-text-primary"
                        : "border-surface-border text-text-secondary hover:border-surface-border-strong hover:text-text-primary"
                    }`}
                  >
                    <span className="block font-semibold">
                      {route.routeCode}
                      {route.billsHere ? " · bills here" : ""}
                    </span>
                    <span className="block text-text-muted">
                      {route.shift === "MORNING" ? "Morning" : "Evening"} · {route.routeName}
                    </span>
                  </button>
                </form>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
