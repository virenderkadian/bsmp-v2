"use client";

import { TEMPLATES } from "@/lib/notifications/templates";

// Placeholder for the second wave: rate-change announcements and free-text
// notices to a chosen audience. The templates already exist and are tested —
// what is missing is audience selection (all customers / one route / a picked
// list), which is the part worth designing rather than guessing at.
//
// It is shown rather than hidden so the centralised screen reads as one place
// for customer messaging, with the rest visibly on its way.
export function NoticesPanel() {
  const upcoming = (["rate_change_v1", "payment_reminder_v1", "notice_v1"] as const).map((key) => ({
    key,
    ...TEMPLATES[key],
  }));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-dashed border-surface-border-strong bg-surface p-4">
        <h2 className="text-sm font-semibold text-text-primary">Not built yet</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Bills send from the first tab today. These message types are written and tested, but still need
          a way to choose who receives them — everyone in the city, one route, or a hand-picked list.
        </p>
      </div>

      <div className="space-y-3">
        {upcoming.map((template) => (
          <div key={template.key} className="rounded-lg border border-surface-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-text-primary">{template.label}</h3>
              <span
                className={
                  template.category === "MARKETING"
                    ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
                    : "rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-text-secondary"
                }
              >
                {template.category}
              </span>
            </div>
            <p className="mt-1 text-sm text-text-secondary">{template.description}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-surface-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text-primary">Why the MARKETING label matters</h2>
        <p className="mt-1 text-sm text-text-secondary">
          WhatsApp treats a bill and a promotion very differently. Utility messages are about a service
          the customer already has and are broadly tolerated; marketing needs its own consent and is what
          actually gets numbers banned. A free-text notice counts as marketing because its content is
          unconstrained — WhatsApp judges what you sent, not what you called it.
        </p>
      </div>
    </div>
  );
}
