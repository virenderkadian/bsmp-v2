"use client";

import { useEffect, useState, useTransition } from "react";
import { refreshTemplatesAction, submitTemplateAction } from "@/app/whatsapp/actions";
import type { TemplateRow, TemplatesState } from "@/lib/notifications/template-admin";

const STATUS_STYLE: Record<TemplateRow["status"], { label: string; className: string }> = {
  not_created: { label: "Not submitted", className: "bg-surface-muted text-text-secondary" },
  pending: { label: "With Meta (pending)", className: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved", className: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected", className: "bg-rose-100 text-rose-800" },
  unknown: { label: "Unknown status", className: "bg-surface-muted text-text-secondary" },
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
        <button
          type="button"
          onClick={refresh}
          disabled={isPending}
          className="rounded-md border border-surface-border px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-surface-muted disabled:opacity-50"
        >
          {isPending && busyKey === null ? "Refreshing…" : "Refresh status"}
        </button>
      </div>

      {state === null ? <p className="text-sm text-text-muted">Loading…</p> : null}
      {state && !state.ok ? (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{state.message}</div>
      ) : null}
      {state && state.ok && state.notice ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{state.notice}</div>
      ) : null}

      {state && state.ok
        ? state.rows.map((row) => {
            const style = STATUS_STYLE[row.status];
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
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${style.className}`}>{style.label}</span>
                </div>
                <p className="mt-2 text-sm text-text-secondary">{row.description}</p>

                <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-surface-muted p-3 text-xs text-text-primary">
                  {row.body}
                  {"\n\n"}
                  {row.footer}
                  {row.buttons.length > 0 ? `\n\n[ ${row.buttons.join(" ] [ ")} ]` : ""}
                </pre>

                {row.status === "rejected" && row.rejectionReason ? (
                  <p className="mt-2 text-sm text-rose-700">Meta&apos;s reason: {row.rejectionReason}</p>
                ) : null}

                {canSubmit ? (
                  <button
                    type="button"
                    onClick={() => submit(row.key)}
                    disabled={isPending}
                    className="mt-3 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {busyKey === row.key ? "Submitting…" : row.status === "rejected" ? "Resubmit to Meta" : "Submit to Meta"}
                  </button>
                ) : null}
              </div>
            );
          })
        : null}
    </div>
  );
}
