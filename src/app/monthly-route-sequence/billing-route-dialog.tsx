"use client";

import { useState } from "react";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { Dialog } from "@/components/admin/dialog";
import type { BillingRouteChoice } from "@/app/monthly-route-sequence/actions";

// Asked whenever adding a customer to a route they already run alongside
// another one that month. They get ONE combined bill covering every route, so
// this is only about which route it's issued against — deliveries still happen
// on both, and Daily Entry is unaffected either way.
export function BillingRouteDialog({
  choice,
  pending,
  onCancel,
  onConfirm,
}: {
  choice: BillingRouteChoice;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (billingRouteId: string) => void;
}) {
  // Deliberately no pre-selection: the whole point is a deliberate answer, and
  // defaulting one would let it be accepted without being read.
  const [selected, setSelected] = useState("");

  return (
    <Dialog
      open
      onClose={onCancel}
      title="Which route should this customer be billed on?"
      description={`${choice.customerName} will run on more than one route this month. They get a single bill covering all of them — choose where it appears.`}
      footer={null}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          {choice.options.map((option) => {
            const isSelected = selected === option.routeId;

            return (
              <label
                key={option.routeId}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                  isSelected
                    ? "border-accent bg-accent/5"
                    : "border-surface-border hover:border-surface-border-strong"
                }`}
              >
                <input
                  type="radio"
                  name="billingRouteId"
                  value={option.routeId}
                  checked={isSelected}
                  onChange={() => setSelected(option.routeId)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-text-primary">
                    {option.routeCode} — {option.routeName}
                  </span>
                  <span className="block text-xs text-text-muted">
                    {option.shift === "MORNING" ? "Morning" : "Evening"}
                    {option.isNew ? " · being added now" : " · already on this route"}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        <p className="text-xs text-text-muted">
          The other route still delivers to this customer as normal — it just
          won&apos;t show their bill.
        </p>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-surface-border pt-4">
          <SecondaryButton type="button" onClick={onCancel} disabled={pending}>
            Cancel
          </SecondaryButton>
          <PrimaryButton
            type="button"
            onClick={() => onConfirm(selected)}
            disabled={!selected || pending}
          >
            {pending ? "Adding…" : "Add customer"}
          </PrimaryButton>
        </div>
      </div>
    </Dialog>
  );
}
