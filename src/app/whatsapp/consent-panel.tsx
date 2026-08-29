"use client";

import { useActionState, useMemo, useState } from "react";
import { bulkOptInCustomers, toggleConsent, type WhatsAppActionState } from "@/app/whatsapp/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { SearchInput } from "@/components/admin/search-input";
import { SummaryStatBar } from "@/components/admin/summary-stat-bar";
import type { ConsentCustomer, ConsentSummary } from "@/lib/notifications/consent";

const initialState: WhatsAppActionState = { status: "idle" };

// Timezone pinned for the same reason as in outbox-panel.tsx: an unpinned
// format renders as UTC on the server and IST in the browser, which is a
// hydration mismatch — and near midnight IST it also names the wrong day.
function formatDate(value: Date | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

export function ConsentPanel({
  canSend,
  summary,
  customers,
}: {
  canSend: boolean;
  summary: ConsentSummary;
  customers: ConsentCustomer[];
}) {
  const [toggleState, toggleAction] = useActionState(toggleConsent, initialState);
  const [bulkState, bulkAction, bulkPending] = useActionState(bulkOptInCustomers, initialState);
  const [query, setQuery] = useState("");
  const [showBulk, setShowBulk] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers;

    return customers.filter(
      (customer) =>
        customer.code.toLowerCase().includes(needle) ||
        customer.name.toLowerCase().includes(needle) ||
        (customer.mobile ?? "").includes(needle),
    );
  }, [customers, query]);

  return (
    <div className="space-y-4">
      <SummaryStatBar
        stats={[
          { key: "optedIn", label: "Opted in", value: String(summary.optedIn), tone: "success" },
          { key: "notOptedIn", label: "Not asked", value: String(summary.eligibleNotOptedIn) },
          {
            key: "unreachable",
            label: "No usable number",
            value: String(summary.unreachable),
            tone: summary.unreachable > 0 ? "danger" : "default",
          },
          { key: "total", label: "Active customers", value: String(summary.total) },
        ]}
      />

      <div className="rounded-lg border border-surface-border bg-surface p-4">
        <p className="text-sm text-text-secondary">
          WhatsApp requires customers to have agreed before a business messages them, and India&apos;s
          DPDP Act requires knowing <strong className="font-semibold text-text-primary">when</strong> they
          agreed. Nothing is ever queued for a customer without a date recorded here.
        </p>

        {summary.eligibleNotOptedIn > 0 && canSend ? (
          <div className="mt-3">
            {showBulk ? (
              <form action={bulkAction} className="space-y-3 rounded-md border border-surface-border p-3">
                <p className="text-sm text-text-primary">
                  This records consent for{" "}
                  <strong className="font-semibold">{summary.eligibleNotOptedIn} customers</strong> who
                  have a usable number and were never asked. Anyone who previously opted out is left
                  alone.
                </p>
                <input
                  name="confirm"
                  placeholder="Type OPT IN ALL to confirm"
                  className="w-full rounded-md border border-surface-border bg-surface px-3 py-2 text-sm text-text-primary"
                  autoComplete="off"
                />
                <div className="flex gap-2">
                  <PrimaryButton type="submit" disabled={bulkPending}>
                    {bulkPending ? "Opting in…" : "Confirm"}
                  </PrimaryButton>
                  <SecondaryButton type="button" onClick={() => setShowBulk(false)}>
                    Cancel
                  </SecondaryButton>
                </div>
              </form>
            ) : (
              <SecondaryButton type="button" onClick={() => setShowBulk(true)}>
                Opt in {summary.eligibleNotOptedIn} existing customer(s)
              </SecondaryButton>
            )}
          </div>
        ) : null}

        {[toggleState, bulkState].map((state, index) =>
          state.status !== "idle" && state.message ? (
            <p
              key={index}
              className={
                state.status === "error" ? "mt-3 text-sm text-rose-700" : "mt-3 text-sm text-emerald-700"
              }
            >
              {state.message}
            </p>
          ) : null,
        )}
      </div>

      <SearchInput
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by code, name, or number"
      />

      <div className="overflow-hidden rounded-lg border border-surface-border bg-surface">
        <ul className="divide-y divide-surface-border">
          {filtered.map((customer) => {
            const optedInOn = formatDate(customer.optedInAt);

            return (
              <li key={customer.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text-primary">
                    {customer.code} · {customer.name}
                  </p>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    {customer.unreachableReason ? (
                      <span className="text-rose-700">{customer.unreachableReason}</span>
                    ) : optedInOn ? (
                      `Opted in ${optedInOn}`
                    ) : (
                      "Not asked yet"
                    )}
                    {customer.mobile ? ` · ${customer.mobile}` : ""}
                  </p>
                </div>

                {canSend && !customer.unreachableReason ? (
                  <form action={toggleAction}>
                    <input type="hidden" name="customerId" value={customer.id} />
                    <input type="hidden" name="optIn" value={customer.optedInAt ? "false" : "true"} />
                    <SecondaryButton type="submit">
                      {customer.optedInAt ? "Opt out" : "Opt in"}
                    </SecondaryButton>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>

        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-text-secondary">No customers match that search.</p>
        ) : null}
      </div>
    </div>
  );
}
