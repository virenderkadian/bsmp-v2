"use client";

import { useMemo, useState } from "react";
import { DataTable } from "@/components/admin/data-table";
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
        log.entityType.toLowerCase().includes(query) ||
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
          placeholder="Search by actor, summary, or city"
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
            <span key="summary" className="text-sm text-text-primary">
              {log.summary}
            </span>,
            <span key="city" className="text-sm text-text-secondary">
              {log.cityName ?? "—"}
            </span>,
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
    </section>
  );
}
