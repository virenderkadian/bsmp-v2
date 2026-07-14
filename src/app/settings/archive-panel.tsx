"use client";

import { useActionState, useState } from "react";
import {
  confirmArchiveDelete,
  restoreArchiveAction,
  runArchiveExport,
  type ArchiveActionState,
} from "@/app/settings/archive-actions";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { DataTable } from "@/components/admin/data-table";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { StatusBadge } from "@/components/admin/status-badge";
import type { ArchivePayload } from "@/lib/settings";

const initialState: ArchiveActionState = { status: "idle" };

function formatMonth(value: string) {
  return new Date(`${value}-01T00:00:00.000Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function ExportRow({ candidate }: { candidate: ArchivePayload["candidates"][number] }) {
  const [state, action, pending] = useActionState(runArchiveExport, initialState);
  const monthValue = candidate.billingMonth.toISOString().slice(0, 7);

  return (
    <div className="rounded-lg border border-surface-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">
            {candidate.routeCode} - {candidate.routeName}{" "}
            <span className="font-normal text-text-secondary">· {candidate.cityName}</span>
          </p>
          <p className="mt-0.5 text-sm text-text-secondary">
            {formatMonth(monthValue)} · {candidate.entryCount} daily entries · {candidate.billCount} bill
            {candidate.billCount === 1 ? "" : "s"} locked {candidate.lockedDaysAgo} days ago
          </p>
        </div>
        <form action={action}>
          <input type="hidden" name="routeId" value={candidate.routeId} />
          <input type="hidden" name="billingMonth" value={monthValue} />
          <input type="hidden" name="cityId" value={candidate.cityId} />
          <input type="hidden" name="cityCode" value={candidate.cityCode} />
          <input type="hidden" name="routeCode" value={candidate.routeCode} />
          <PrimaryButton type="submit" disabled={pending} className="h-9 px-4 text-sm font-semibold">
            {pending ? "Exporting & verifying..." : "Export & verify"}
          </PrimaryButton>
        </form>
      </div>
      {state.status !== "idle" && state.message ? (
        <p className={`mt-2 text-sm ${state.status === "success" ? "text-emerald-700" : "text-rose-700"}`}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

function DeleteConfirm({ record }: { record: ArchivePayload["records"][number] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(confirmArchiveDelete, initialState);

  if (state.status === "success" && open) {
    setOpen(false);
  }

  return (
    <>
      <SecondaryButton type="button" onClick={() => setOpen(true)} className="h-8 px-3 text-xs font-semibold">
        Confirm delete
      </SecondaryButton>
      <ConfirmDialog
        open={open}
        title="Delete archived rows from the database?"
        description="This re-verifies the file in storage one more time, then permanently removes these rows from Postgres. The data stays recoverable from the archive afterward."
        confirmLabel={pending ? "Deleting..." : "Delete from database"}
        pending={pending}
        onClose={() => setOpen(false)}
        action={action}
      >
        <input type="hidden" name="id" value={record.id} />
        <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-text-secondary">
          <span className="font-semibold text-text-primary">
            {record.routeCode} — {formatMonth(record.billingMonth)}
          </span>
          <br />
          {record.entryCount} entries, {record.lineCount} lines, {record.productEntryCount} product rows,{" "}
          {record.sequenceCount} sequence rows.
        </p>
        {state.status === "error" && state.message ? (
          <p className="text-sm font-medium text-rose-700">{state.message}</p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

function RestoreConfirm({ record }: { record: ArchivePayload["records"][number] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(restoreArchiveAction, initialState);

  if (state.status === "success" && open) {
    setOpen(false);
  }

  return (
    <>
      <SecondaryButton type="button" onClick={() => setOpen(true)} className="h-8 px-3 text-xs font-semibold">
        Restore
      </SecondaryButton>
      <ConfirmDialog
        open={open}
        title="Restore archived rows into the database?"
        description="Re-downloads the archive file, checks it against the recorded checksum, and re-inserts the rows with their original ids."
        confirmLabel={pending ? "Restoring..." : "Restore"}
        pending={pending}
        onClose={() => setOpen(false)}
        action={action}
      >
        <input type="hidden" name="id" value={record.id} />
        <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-text-secondary">
          <span className="font-semibold text-text-primary">
            {record.routeCode} — {formatMonth(record.billingMonth)}
          </span>
          <br />
          {record.entryCount} entries will be restored.
        </p>
        {state.status === "error" && state.message ? (
          <p className="text-sm font-medium text-rose-700">{state.message}</p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "EXPORTED") return "warning";
  if (status === "DELETED") return "success";
  if (status === "RESTORED") return "info";
  return "neutral";
}

export function ArchivePanel({ payload }: { payload: ArchivePayload }) {
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">Daily-entry archival</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Moves old daily-entry data out of Postgres once a route&apos;s month is fully billed and locked, to
          keep database storage in check. Financial records (bills, payments) are never archived.
        </p>
      </div>

      {!payload.storageConfigured ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Archive storage isn&apos;t configured yet — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
          and R2_BUCKET_NAME in the environment before exporting.
        </div>
      ) : null}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Eligible to archive ({payload.candidates.length})
        </h3>
        {payload.candidates.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Nothing eligible right now — a route/month qualifies once every bill for it is Locked and it&apos;s
            been at least 60 days since the last lock.
          </p>
        ) : (
          <div className="space-y-3">
            {payload.candidates.map((candidate) => (
              <ExportRow key={`${candidate.routeId}-${candidate.billingMonth.toISOString()}`} candidate={candidate} />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">Archive history</h3>
        <DataTable
          columns={[
            { key: "route", label: "Route / Month" },
            { key: "counts", label: "Rows" },
            { key: "status", label: "Status" },
            { key: "actions", label: "Actions", className: "text-right", headerClassName: "text-right" },
          ]}
          rows={payload.records.map((record) => ({
            key: record.id,
            cells: [
              <div key="route" className="min-w-[220px]">
                <p className="text-sm font-semibold text-text-primary">
                  {record.routeCode} - {record.routeName}
                </p>
                <p className="text-xs text-text-secondary">
                  {record.cityName} · {formatMonth(record.billingMonth)}
                </p>
              </div>,
              <span key="counts" className="text-sm text-text-secondary">
                {record.entryCount} entries, {record.productEntryCount} product rows
              </span>,
              <StatusBadge key="status" tone={statusTone(record.status)}>
                {record.status}
              </StatusBadge>,
              <div key="actions" className="flex justify-end gap-2">
                {record.status === "EXPORTED" ? <DeleteConfirm record={record} /> : null}
                {record.status === "DELETED" ? <RestoreConfirm record={record} /> : null}
              </div>,
            ],
          }))}
          emptyMessage="No archives yet"
          minWidth="min-w-[720px]"
          className="rounded-md border-surface-border shadow-none"
          headClassName="bg-surface-muted/70"
          headerCellClassName="px-5 py-3"
          rowClassName="align-middle hover:bg-surface-muted/60"
          cellClassName="px-5 py-3.5"
        />
      </div>
    </section>
  );
}
