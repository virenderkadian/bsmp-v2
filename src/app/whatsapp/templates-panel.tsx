"use client";

import { useEffect, useState, useTransition } from "react";
import { refreshTemplatesAction, submitTemplateAction } from "@/app/whatsapp/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { StatusBadge } from "@/components/admin/status-badge";
import type { TemplateRow, TemplatesState } from "@/lib/notifications/template-admin";

const STATUS: Record<TemplateRow["status"], { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  not_created: { label: "Not submitted", tone: "neutral" },
  pending: { label: "With Meta (pending)", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  unknown: { label: "Unknown status", tone: "neutral" },
};

// Which WhatsApp templates exist at Zoepact/Meta and in what state. Loaded when
// the tab opens (not with the page) because it calls an outside service.
export function TemplatesPanel() {
  const [state, setState] = useState<TemplatesState | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = () => startTransition(async () => setState(await refreshTemplatesAction()));

  useEffect(() => {
    startTransition(async () => setState(await refreshTemplatesAction()));
  }, []);

  const submit = (key: string) => {
    setBusyKey(key);
    startTransition(async () => {
      setState(await submitTemplateAction(key));
      setBusyKey(null);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">
          Messages sent outside the 24-hour reply window must use a template approved by Meta. Submit each one
          once; approval usually takes minutes to 24 hours. An approved template can&apos;t be reworded.
        </p>
        <SecondaryButton type="button" onClick={refresh} disabled={isPending}>
          {isPending && busyKey === null ? "Refreshing…" : "Refresh status"}
        </SecondaryButton>
      </div>

      {state === null ? <p className="text-sm text-text-muted">Loading…</p> : null}
      {state && !state.ok ? (
        <div className="rounded-lg bg-status-danger-bg p-3 text-sm text-status-danger-text">{state.message}</div>
      ) : null}
      {state && state.ok && state.notice ? (
        <div className="rounded-lg bg-status-success-bg p-3 text-sm text-status-success-text">{state.notice}</div>
      ) : null}

      {state && state.ok
        ? state.rows.map((row) => {
            const status = STATUS[row.status];
            const canSubmit = row.status === "not_created" || row.status === "rejected";
            return (
              <div key={row.key} className="rounded-lg border border-surface-border bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">{row.label}</h3>
                    <p className="text-xs text-text-muted">
                      {row.zoepactName} · {row.category} · {row.language}
                    </p>
                  </div>
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </div>
                <p className="mt-2 text-sm text-text-secondary">{row.description}</p>

                <div className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-muted p-3 text-sm leading-relaxed text-text-primary">
                  {row.body}
                  {"\n\n"}
                  {row.footer}
                  {row.buttons.length > 0 ? `\n\n[ ${row.buttons.join(" ] [ ")} ]` : ""}
                </div>

                {row.status === "rejected" && row.rejectionReason ? (
                  <p className="mt-2 text-sm text-status-danger-text">Meta&apos;s reason: {row.rejectionReason}</p>
                ) : null}

                {canSubmit ? (
                  <PrimaryButton type="button" className="mt-3" onClick={() => submit(row.key)} disabled={isPending}>
                    {busyKey === row.key ? "Submitting…" : row.status === "rejected" ? "Resubmit to Meta" : "Submit to Meta"}
                  </PrimaryButton>
                ) : null}
              </div>
            );
          })
        : null}
    </div>
  );
}
