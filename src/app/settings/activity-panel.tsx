"use client";

import { useMemo, useState } from "react";
import { DataTable } from "@/components/admin/data-table";
import { Dialog } from "@/components/admin/dialog";
import { IconButton } from "@/components/admin/icon-button";
import { ViewIcon } from "@/components/admin/icons";
import { SearchInput } from "@/components/admin/search-input";
import { StatusBadge } from "@/components/admin/status-badge";
import type { AuditLogRecord } from "@/lib/settings";

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function actionTone(action: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (action === "CREATE") return "success";
  if (action === "BLOCKED") return "danger";
  if (action === "STATUS_CHANGE") return "warning";
  if (action === "UPDATE" || action === "SAVE" || action === "GENERATE") return "info";
  return "neutral";
}

export function ActivityPanel({ dbConnected, logs }: { dbConnected: boolean; logs: AuditLogRecord[] }) {
  const [selected, setSelected] = useState<AuditLogRecord | null>(null);
  const [search, setSearch] = useState("");

  const entityTypes = useMemo(
    () => Array.from(new Set(logs.map((log) => log.entityType))).sort(),
    [logs],
  );
  const [entityFilter, setEntityFilter] = useState<string>("ALL");

  const filteredLogs = useMemo(() => {
    const query = search.toLowerCase().trim();

    return logs.filter((log) => {
      if (entityFilter !== "ALL" && log.entityType !== entityFilter) {
        return false;
      }

      if (query === "") {
        return true;
      }

      return (
        log.actorName.toLowerCase().includes(query) ||
        log.summary.toLowerCase().includes(query) ||
        log.summaryLabel.toLowerCase().includes(query) ||
        log.entityType.toLowerCase().includes(query) ||
        // Action is shown as a badge on every row, so it's a natural thing to
        // search for — it just wasn't included.
        log.action.toLowerCase().includes(query) ||
        (log.cityName?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [logs, search, entityFilter]);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Activity</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Who did what, when — the most recent {logs.length} entries across every city.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          name="auditSearch"
          placeholder="Search by actor, action, summary, or city"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-xs"
        />
        <select
          value={entityFilter}
          onChange={(event) => setEntityFilter(event.target.value)}
          className="h-10 rounded-md border border-surface-border bg-surface px-3 text-sm text-text-primary shadow-sm focus:border-slate-400 focus:outline-none"
        >
          <option value="ALL">All entities</option>
          {entityTypes.map((entityType) => (
            <option key={entityType} value={entityType}>
              {entityType}
            </option>
          ))}
        </select>
        {dbConnected ? null : <StatusBadge tone="warning">Offline fallback</StatusBadge>}
      </div>

      <DataTable
        columns={[
          { key: "when", label: "When" },
          { key: "actor", label: "Actor" },
          { key: "entity", label: "Entity" },
          { key: "action", label: "Action" },
          { key: "summary", label: "Summary" },
          { key: "city", label: "City" },
          { key: "view", label: "" },
        ]}
        rows={filteredLogs.map((log) => ({
          key: log.id,
          cells: [
            <span key="when" className="whitespace-nowrap text-sm text-text-secondary">
              {formatTimestamp(log.createdAt)}
            </span>,
            <div key="actor" className="min-w-[140px]">
              <p className="text-sm font-medium text-text-primary">{log.actorName}</p>
              <p className="text-xs text-text-secondary">{log.actorRole}</p>
            </div>,
            <span key="entity" className="text-sm text-text-secondary">
              {log.entityType}
            </span>,
            <StatusBadge key="action" tone={actionTone(log.action)}>
              {log.action}
            </StatusBadge>,
            // Clamped to one line: summaries vary from a few words to a
            // paragraph, and letting the long ones wrap pushed every other
            // column out of alignment. Full text is one click away.
            <span
              key="summary"
              className="block max-w-[380px] truncate text-sm text-text-primary"
              title={log.summaryLabel}
            >
              {log.summaryLabel}
            </span>,
            <span key="city" className="text-sm text-text-secondary">
              {log.cityName ?? "—"}
            </span>,
            <IconButton
              key="view"
              type="button"
              onClick={() => setSelected(log)}
              aria-label="View activity detail"
            >
              <ViewIcon className="h-4 w-4" />
            </IconButton>,
          ],
        }))}
        emptyMessage="No activity matches your search"
        minWidth="min-w-[860px]"
        className="rounded-md border-surface-border shadow-none"
        headClassName="bg-surface-muted/70"
        headerCellClassName="px-5 py-3"
        rowClassName="align-middle hover:bg-surface-muted/60"
        cellClassName="px-5 py-3.5"
      />

      <Dialog
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="Activity detail"
        description={selected ? `${selected.action} · ${selected.entityType}` : undefined}
        footer={null}
      >
        {selected ? (
          <div className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <DetailField label="When" value={formatTimestamp(selected.createdAt)} />
              <DetailField label="City" value={selected.cityName ?? "—"} />
              <DetailField label="Actor" value={`${selected.actorName} (${selected.actorRole})`} />
              <DetailField label="Entity" value={selected.entityType} />
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Summary</p>
              <p className="mt-1 whitespace-pre-wrap text-text-primary">{selected.summaryLabel}</p>
            </div>

            {/* Only when it differs — showing the raw form every time would be
                noise, but it's the only place the underlying id survives. */}
            {selected.summary !== selected.summaryLabel ? (
              <details>
                <summary className="cursor-pointer text-xs text-text-muted">Show raw summary (with ids)</summary>
                <p className="mt-1 whitespace-pre-wrap break-all text-xs text-text-secondary">{selected.summary}</p>
              </details>
            ) : null}

            {selected.before !== null && selected.before !== undefined ? (
              <DetailJson label="Before" value={selected.before} />
            ) : null}
            {selected.after !== null && selected.after !== undefined ? (
              <DetailJson label="After" value={selected.after} />
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-0.5 text-text-primary">{value}</p>
    </div>
  );
}

function DetailJson({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <pre className="mt-1 max-h-52 overflow-auto rounded-md bg-surface-muted p-3 text-xs text-text-secondary">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
