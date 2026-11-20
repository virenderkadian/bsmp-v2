"use client";

import { useEffect, useState, useTransition } from "react";
import {
  refreshTemplatesAction, saveTemplateWordingAction, submitTemplateAction, switchTemplateVersionAction,
} from "@/app/whatsapp/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { FormInput } from "@/components/admin/form-input";
import { FormTextarea } from "@/components/admin/form-textarea";
import { StatusBadge } from "@/components/admin/status-badge";
import type { TemplateRow, TemplatesState, VersionRow } from "@/lib/notifications/template-admin";
import { validateWording } from "@/lib/notifications/zoepact-templates";

const STATUS: Record<VersionRow["status"], { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  not_created: { label: "Not submitted", tone: "neutral" },
  pending: { label: "With Meta (pending)", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  unknown: { label: "Unknown status", tone: "neutral" },
};

// The wording of a message as the customer reads it, plus its footer and button.
function Wording({ version }: { version: VersionRow }) {
  return (
    <div className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-surface-muted p-3 text-sm leading-relaxed text-text-primary">
      {version.body}
      {"\n\n"}
      {version.footer}
      {version.buttonText ? `\n\n[ ${version.buttonText} ]` : ""}
    </div>
  );
}

// Reword a message. It saves as a NEW version, because Meta approves each wording
// separately: the old version keeps working until the new one is approved and switched on.
function Editor({ row, from, onSave, onCancel, busy }: {
  row: TemplateRow;
  from: VersionRow;
  onSave: (body: string, footer: string, buttonText: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [body, setBody] = useState(from.body);
  const [footer, setFooter] = useState(from.footer);
  const [buttonText, setButtonText] = useState(from.buttonText ?? "");

  const errors = validateWording(row.key, { body, footer, buttonText });
  const unchanged = body.trim() === from.body && footer.trim() === from.footer && (buttonText.trim() === (from.buttonText ?? ""));

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-surface-border p-3">
      <h4 className="text-sm font-semibold text-text-primary">Reword this message</h4>
      <p className="text-sm text-text-secondary">
        Change the words around the blanks. Keep every blank, written exactly like {"{{1}}"}. Each blank is filled in for the
        customer when the message is sent:
      </p>
      <ul className="space-y-0.5 text-sm text-text-secondary">
        {row.slotHelp.map((help, index) => (
          <li key={index}>
            <span className="font-medium tabular-nums text-text-primary">{`{{${index + 1}}}`}</span> {help}
          </li>
        ))}
      </ul>

      <FormTextarea label="Message" rows={12} value={body} onChange={(event) => setBody(event.target.value)} />
      <FormInput label="Footer (under 60 characters)" value={footer} onChange={(event) => setFooter(event.target.value)} />
      {row.buttonLabel !== null ? (
        <FormInput label="Button label (under 25 characters)" value={buttonText} onChange={(event) => setButtonText(event.target.value)} />
      ) : null}

      {errors.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-status-danger-text">
          {errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <PrimaryButton type="button" onClick={() => onSave(body, footer, buttonText)} disabled={busy || errors.length > 0 || unchanged}>
          {busy ? "Saving…" : "Save as new version"}
        </PrimaryButton>
        <SecondaryButton type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </SecondaryButton>
      </div>
      <p className="text-xs text-text-secondary">
        Saving doesn&apos;t change what customers get. After you save, submit the new version to Meta, and switch to it once it is approved.
      </p>
    </div>
  );
}

// Which WhatsApp templates exist at Zoepact/Meta, in what state, and the wording of each
// version. Loaded when the tab opens (not with the page) because it calls an outside service.
export function TemplatesPanel() {
  const [state, setState] = useState<TemplatesState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (id: string, action: () => Promise<TemplatesState>, after?: (next: TemplatesState) => void) => {
    setBusy(id);
    startTransition(async () => {
      const next = await action();
      setState(next);
      setBusy(null);
      after?.(next);
    });
  };

  const refresh = () => run("refresh", () => refreshTemplatesAction());

  useEffect(() => {
    startTransition(async () => setState(await refreshTemplatesAction()));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">
          Messages sent outside the 24-hour reply window must use a template approved by Meta. Each wording is approved
          separately, so rewording a message makes a new version: submit it, and switch to it once it shows Approved.
        </p>
        <SecondaryButton type="button" onClick={refresh} disabled={isPending}>
          {isPending && busy === "refresh" ? "Refreshing…" : "Refresh status"}
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
            const inUse = row.versions.find((version) => version.isActive) ?? row.versions[row.versions.length - 1];
            return (
              <div key={row.key} className="rounded-lg border border-surface-border bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">{row.label}</h3>
                    <p className="text-xs text-text-muted">
                      {row.category} · {row.language} · in use: version {inUse.version}
                    </p>
                  </div>
                  <SecondaryButton type="button" onClick={() => setEditing(editing === row.key ? null : row.key)} disabled={isPending}>
                    {editing === row.key ? "Close editor" : "Reword this message"}
                  </SecondaryButton>
                </div>
                <p className="mt-2 text-sm text-text-secondary">{row.description}</p>

                {editing === row.key ? (
                  <Editor
                    row={row}
                    from={inUse}
                    busy={isPending && busy === `save:${row.key}`}
                    onCancel={() => setEditing(null)}
                    onSave={(body, footer, buttonText) =>
                      run(`save:${row.key}`, () => saveTemplateWordingAction(row.key, body, footer, buttonText), (next) => {
                        if (next.ok) setEditing(null);
                      })
                    }
                  />
                ) : null}

                <div className="mt-3 space-y-3">
                  {row.versions.map((version) => {
                    const status = STATUS[version.status];
                    const id = `${row.key}:${version.versionId ?? "built-in"}`;
                    const canSubmit = version.status === "not_created" || version.status === "rejected";
                    const canUse = version.status === "approved" && !version.isActive;
                    return (
                      <div key={id} className="rounded-lg border border-surface-border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-text-primary">Version {version.version}</span>
                            <span className="text-xs text-text-muted">{version.zoepactName}</span>
                            {version.isActive ? <StatusBadge tone="info">In use</StatusBadge> : null}
                          </div>
                          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                        </div>
                        {version.createdByName ? (
                          <p className="mt-1 text-xs text-text-muted">Written by {version.createdByName}</p>
                        ) : version.versionId === null ? (
                          <p className="mt-1 text-xs text-text-muted">Built-in wording</p>
                        ) : null}

                        <details className="mt-2">
                          <summary className="cursor-pointer text-sm text-text-secondary">Show the wording</summary>
                          <Wording version={version} />
                        </details>

                        {version.status === "rejected" && version.rejectionReason ? (
                          <p className="mt-2 text-sm text-status-danger-text">Meta&apos;s reason: {version.rejectionReason}</p>
                        ) : null}

                        {canSubmit || canUse ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {canSubmit ? (
                              <PrimaryButton type="button" disabled={isPending} onClick={() => run(id, () => submitTemplateAction(row.key, version.versionId))}>
                                {busy === id ? "Submitting…" : version.status === "rejected" ? "Resubmit to Meta" : "Submit to Meta"}
                              </PrimaryButton>
                            ) : null}
                            {canUse ? (
                              <PrimaryButton type="button" disabled={isPending} onClick={() => run(id, () => switchTemplateVersionAction(row.key, version.versionId))}>
                                {busy === id ? "Switching…" : "Use this version"}
                              </PrimaryButton>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        : null}
    </div>
  );
}
