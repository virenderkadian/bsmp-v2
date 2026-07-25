"use client";

import { useEffect, useRef, useState, useActionState } from "react";
import { createCustomersBulk, type ActionState } from "@/app/masters/actions";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { EmptyState } from "@/components/admin/empty-state";
import { IconButton } from "@/components/admin/icon-button";
import { PlusIcon, XIcon } from "@/components/admin/icons";
import { usePageMetric } from "@/components/admin/page-metric";
import { StickyActionBar } from "@/components/admin/sticky-action-bar";
import { Toast, type ToastTone } from "@/components/admin/toast";

const initialState: ActionState = { status: "idle" };

type DraftRow = {
  id: string;
  name: string;
  mobile: string;
  area: string;
  openingBalance: string;
};

type ToastState = { tone: ToastTone; message: string };

function makeRow(name = ""): DraftRow {
  return { id: crypto.randomUUID(), name, mobile: "", area: "", openingBalance: "0" };
}

const cellInputClass =
  "h-9 w-full rounded-md border border-surface-border-strong bg-surface px-2.5 text-sm text-text-primary outline-none transition focus:border-accent disabled:bg-surface-muted";

export function BulkAddCustomersScreen() {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [newName, setNewName] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState(createCustomersBulk, initialState);

  const validRows = rows.filter((row) => row.name.trim().length >= 2);
  const canSave = validRows.length > 0 && !pending;

  usePageMetric(rows.length > 0 ? { label: "Ready", value: String(validRows.length) } : null);

  // Handle each action result once (render-time), then clear on success.
  const actionResultKey = state.status !== "idle" && state.message ? `${state.status}:${state.message}` : null;
  const [processedActionKey, setProcessedActionKey] = useState<string | null>(null);
  if (actionResultKey && state.message && actionResultKey !== processedActionKey) {
    setProcessedActionKey(actionResultKey);
    setToast({ tone: state.status === "success" ? "success" : "error", message: state.message });
    if (state.status === "success") {
      setRows([]);
      setNewName("");
    }
  }

  useEffect(() => {
    if (processedActionKey?.startsWith("success:")) {
      nameInputRef.current?.focus();
    }
  }, [processedActionKey]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const addRow = (name: string) => {
    setRows((prev) => [...prev, makeRow(name.trim())]);
    setNewName("");
    nameInputRef.current?.focus();
  };

  const updateRow = (id: string, field: keyof Omit<DraftRow, "id">, value: string) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  };

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
  };

  const customersJson = JSON.stringify(
    validRows.map((row) => ({
      name: row.name.trim(),
      mobile: row.mobile.trim() || undefined,
      area: row.area.trim() || undefined,
      openingBalance: Number(row.openingBalance) || 0,
    })),
  );

  const missingNames = rows.length - validRows.length;

  return (
    <div className="space-y-4 pb-24">
      <div className="sticky top-[65px] z-20 -mx-4 border-b border-surface-border bg-app-bg/95 px-4 py-3 backdrop-blur transition-colors duration-200 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={nameInputRef}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (newName.trim()) {
                  addRow(newName);
                }
              }
            }}
            placeholder="Type a customer name, press Enter to add a row"
            className="h-10 min-w-[240px] flex-1 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            autoComplete="off"
            autoFocus
          />
          <PrimaryButton
            type="button"
            icon={<PlusIcon className="h-4 w-4" />}
            className="h-10 shrink-0 rounded-md px-4 text-sm font-semibold"
            onClick={() => {
              if (newName.trim()) {
                addRow(newName);
              }
            }}
            disabled={!newName.trim()}
          >
            Add row
          </PrimaryButton>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState message="No rows yet. Type a name above and press Enter — mobile, area and opening balance are optional." />
      ) : (
        <div className="overflow-hidden rounded-md border border-surface-border bg-surface shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full divide-y divide-surface-border">
              <thead className="bg-surface-muted/80">
                <tr>
                  <th className="w-12 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                    Sr
                  </th>
                  <th className="min-w-[200px] px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                    Name
                  </th>
                  <th className="w-40 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                    Mobile
                  </th>
                  <th className="w-44 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                    Area
                  </th>
                  <th className="w-32 px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                    Opening
                  </th>
                  <th className="w-12 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border bg-surface">
                {rows.map((row, index) => (
                  <tr key={row.id}>
                    <td className="px-4 py-2.5 text-sm font-semibold text-text-secondary">{index + 1}</td>
                    <td className="px-4 py-2.5">
                      <input
                        value={row.name}
                        onChange={(event) => updateRow(row.id, "name", event.target.value)}
                        placeholder="Customer name"
                        className={cellInputClass}
                        aria-label={`Name for row ${index + 1}`}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <input
                        value={row.mobile}
                        onChange={(event) => updateRow(row.id, "mobile", event.target.value)}
                        placeholder="Optional"
                        className={cellInputClass}
                        aria-label={`Mobile for row ${index + 1}`}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <input
                        value={row.area}
                        onChange={(event) => updateRow(row.id, "area", event.target.value)}
                        placeholder="Optional"
                        className={cellInputClass}
                        aria-label={`Area for row ${index + 1}`}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.openingBalance}
                        onChange={(event) => updateRow(row.id, "openingBalance", event.target.value)}
                        className={`${cellInputClass} text-right`}
                        aria-label={`Opening balance for row ${index + 1}`}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end">
                        <IconButton
                          type="button"
                          tone="danger"
                          onClick={() => removeRow(row.id)}
                          aria-label={`Remove row ${index + 1}`}
                          title="Remove row"
                        >
                          <XIcon className="h-5 w-5" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <form id="bulk-add-customers-form" action={formAction}>
        <input type="hidden" name="customersJson" value={customersJson} readOnly />
      </form>

      {rows.length > 0 ? (
        <StickyActionBar>
          <span className="mr-auto text-sm text-text-secondary">
            <span className="font-semibold text-text-primary">{validRows.length}</span> ready to add
            {missingNames > 0 ? ` · ${missingNames} row${missingNames === 1 ? "" : "s"} need a name` : ""}
          </span>
          <SecondaryButton type="button" onClick={() => setRows([])} disabled={pending}>
            Clear all
          </SecondaryButton>
          <PrimaryButton type="submit" form="bulk-add-customers-form" disabled={!canSave}>
            {pending ? "Saving..." : `Save ${validRows.length} customer${validRows.length === 1 ? "" : "s"}`}
          </PrimaryButton>
        </StickyActionBar>
      ) : null}

      {toast ? <Toast tone={toast.tone}>{toast.message}</Toast> : null}
    </div>
  );
}
