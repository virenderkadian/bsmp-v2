"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  addMonthlyRouteSequenceLine,
  createCustomerAndAddToMonthlyRouteSequence,
  removeMonthlyRouteSequenceLine,
  reorderMonthlyRouteSequenceLines,
  type MonthlySequenceActionState,
} from "@/app/monthly-route-sequence/actions";
import { PrimaryButton } from "@/components/admin/buttons";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { CustomerQuickCreateDialog } from "@/components/admin/customer-quick-create-dialog";
import { EmptyState } from "@/components/admin/empty-state";
import { IconButton } from "@/components/admin/icon-button";
import { GripIcon, PlusIcon, XIcon } from "@/components/admin/icons";
import { PageHeader } from "@/components/admin/page-header";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";
import { StatusChip } from "@/components/admin/status-chip";
import { StickyActionBar } from "@/components/admin/sticky-action-bar";
import { Toast, type ToastTone } from "@/components/admin/toast";
import type {
  MonthlyRouteSequencePayload,
  MonthlySequenceCustomerOption,
  MonthlySequenceLineRecord,
} from "@/lib/monthly-route-sequence";
import { cn } from "@/lib/utils";

const initialState: MonthlySequenceActionState = { status: "idle" };

type ToastState = {
  tone: ToastTone;
  message: string;
};

function formatCustomerMeta(customer: MonthlySequenceCustomerOption) {
  return [customer.code, customer.area, customer.mobile].filter(Boolean).join(" · ");
}

function formatLineMeta(line: MonthlySequenceLineRecord) {
  return [line.customerCode, line.customerArea, line.customerMobile].filter(Boolean).join(" · ");
}

function matchesCustomer(customer: MonthlySequenceCustomerOption, query: string) {
  const searchText = [customer.code, customer.name, customer.area, customer.mobile]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return searchText.includes(query.toLowerCase().trim());
}

function resequenceLocalLines(lines: MonthlySequenceLineRecord[]) {
  return lines.map((line, index) => ({
    ...line,
    sequenceNo: index + 1,
  }));
}

function moveLine(lines: MonthlySequenceLineRecord[], sourceId: string, targetId: string) {
  const sourceIndex = lines.findIndex((line) => line.id === sourceId);
  const targetIndex = lines.findIndex((line) => line.id === targetId);

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return lines;
  }

  const nextLines = [...lines];
  const [sourceLine] = nextLines.splice(sourceIndex, 1);
  nextLines.splice(targetIndex, 0, sourceLine);

  return resequenceLocalLines(nextLines);
}

function CustomerSuggestionRow({
  customer,
  active,
  alreadyAdded,
  onSelect,
}: {
  customer: MonthlySequenceCustomerOption;
  active: boolean;
  alreadyAdded: boolean;
  onSelect: (customerId: string) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center justify-between gap-4 px-3 py-2.5 text-left transition",
        active ? "bg-accent-soft" : "bg-surface hover:bg-surface-muted",
      )}
      onClick={() => onSelect(customer.id)}
    >
      <span>
        <span className="block text-sm font-semibold text-text-primary">{customer.name}</span>
        <span className="mt-0.5 block text-xs font-medium uppercase tracking-[0.12em] text-text-secondary">
          {formatCustomerMeta(customer) || "-"}
        </span>
      </span>
      <span
        className={cn(
          "rounded-full px-2.5 py-1 text-xs font-semibold",
          alreadyAdded ? "bg-amber-50 text-amber-700" : "bg-surface-muted text-text-secondary",
        )}
      >
        {alreadyAdded ? "Already added" : "Enter"}
      </span>
    </button>
  );
}

function RouteMonthToolbar({ payload }: { payload: MonthlyRouteSequencePayload }) {
  return (
    <section className="rounded-md border border-surface-border bg-surface p-4 shadow-sm">
      <PageHeader
        title="Monthly Route Customer Sequence"
        subtitle="Build and manage route-wise customer delivery order."
      />
      <div className="grid gap-3 mt-2 lg:grid-cols-[minmax(260px,360px)_180px_auto_1fr] lg:items-end">
        <form action="/monthly-route-sequence" className="contents">
          <SelectInput
            label="Route"
            name="routeId"
            defaultValue={payload.selectedRouteId}
            placeholder="Select route"
            options={payload.routes.map((route) => ({
              value: route.id,
              label: `${route.code} - ${route.name}`,
            }))}
            className="h-10 rounded-md bg-surface text-sm"
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-secondary">Month</span>
            <input
              type="month"
              name="month"
              defaultValue={payload.selectedMonth}
              className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            />
          </label>
          <PrimaryButton type="submit" className="h-10 rounded-md px-5 text-sm font-semibold">
            Load
          </PrimaryButton>
        </form>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <StatusChip tone={payload.dbConnected ? "success" : "warning"}>
            {payload.dbConnected ? "Live data" : "Offline fallback"}
          </StatusChip>
          {payload.error ? <StatusChip tone="warning">Setup warning</StatusChip> : null}
          <StatusChip tone="info">Next sequence: {payload.lines.length + 1}</StatusChip>
        </div>
      </div>

      {payload.error ? <p className="mt-3 text-sm font-medium text-rose-700">{payload.error}</p> : null}
    </section>
  );
}

function AddCustomerBar({
  query,
  suggestionsOpen,
  highlightedIndex,
  suggestions,
  existingLineByCustomerId,
  disabled,
  pending,
  inputRef,
  onQueryChange,
  onSuggestionsOpenChange,
  onHighlightedIndexChange,
  onAddCustomer,
  onOpenQuickCreate,
}: {
  query: string;
  suggestionsOpen: boolean;
  highlightedIndex: number;
  suggestions: MonthlySequenceCustomerOption[];
  existingLineByCustomerId: Map<string, MonthlySequenceLineRecord>;
  disabled: boolean;
  pending: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onSuggestionsOpenChange: (open: boolean) => void;
  onHighlightedIndexChange: (index: number | ((index: number) => number)) => void;
  onAddCustomer: (customerId: string) => void;
  onOpenQuickCreate: () => void;
}) {
  const activeSuggestionIndex = suggestions.length === 0 ? -1 : Math.min(highlightedIndex, suggestions.length - 1);
  const selectedCustomer = suggestions[activeSuggestionIndex] ?? suggestions[0];

  return (
    <section className="rounded-md border border-surface-border bg-surface p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Add customer</h2>
          <p className="mt-0.5 text-xs text-text-secondary">Type and press Enter. Use arrows to pick from matches.</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="relative flex-1">
          <SearchInput
            ref={inputRef}
            value={query}
            onFocus={() => onSuggestionsOpenChange(true)}
            onChange={(event) => {
              onQueryChange(event.target.value);
              onSuggestionsOpenChange(true);
              onHighlightedIndexChange(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                onHighlightedIndexChange((index) =>
                  suggestions.length === 0 ? 0 : Math.min(index + 1, suggestions.length - 1),
                );
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                onHighlightedIndexChange((index) => Math.max(index - 1, 0));
              }

              if (event.key === "Enter") {
                event.preventDefault();

                if (selectedCustomer) {
                  onAddCustomer(selectedCustomer.id);
                  return;
                }

                onOpenQuickCreate();
              }

              if (event.key === "Escape") {
                onQueryChange("");
                onSuggestionsOpenChange(false);
                onHighlightedIndexChange(0);
              }
            }}
            onBlur={() => {
              window.setTimeout(() => onSuggestionsOpenChange(false), 120);
            }}
            disabled={disabled}
            placeholder={
              disabled ? "Select route or fix setup warning first" : "Search by name, code, area, or phone..."
            }
            className="h-10 rounded-md bg-surface text-sm"
            autoComplete="off"
          />

          {suggestionsOpen ? (
            <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-20 overflow-hidden rounded-md border border-surface-border bg-surface shadow-lg">
              {suggestions.length > 0 ? (
                suggestions.map((customer, index) => (
                  <CustomerSuggestionRow
                    key={customer.id}
                    customer={customer}
                    active={index === activeSuggestionIndex}
                    alreadyAdded={existingLineByCustomerId.has(customer.id)}
                    onSelect={onAddCustomer}
                  />
                ))
              ) : (
                <div className="px-3 py-3 text-sm text-text-secondary">No matching active customer found.</div>
              )}
            </div>
          ) : null}
        </div>

        <PrimaryButton
          type="button"
          disabled={disabled || pending}
          icon={<PlusIcon className="h-4 w-4" />}
          className="h-10 rounded-md px-5 text-sm font-semibold"
          onClick={onOpenQuickCreate}
        >
          Add Customer
        </PrimaryButton>
      </div>
    </section>
  );
}

function SequenceTable({
  routeId,
  sequenceMonth,
  initialLines,
  highlightedLineId,
  disabled,
  onToast,
}: {
  routeId: string;
  sequenceMonth: string;
  initialLines: MonthlySequenceLineRecord[];
  highlightedLineId: string | null;
  disabled: boolean;
  onToast: (toast: ToastState) => void;
}) {
  const [lines, setLines] = useState(initialLines);
  const [draggedLineId, setDraggedLineId] = useState<string | null>(null);
  const [dragOverLineId, setDragOverLineId] = useState<string | null>(null);
  const [lineToRemove, setLineToRemove] = useState<MonthlySequenceLineRecord | null>(null);
  const lastActionMessageRef = useRef("");
  const [reorderState, reorderAction, reorderPending] = useActionState(reorderMonthlyRouteSequenceLines, initialState);
  const [removeState, removeAction, removePending] = useActionState(removeMonthlyRouteSequenceLine, initialState);
  const [reorderTransitionPending, startReorderTransition] = useTransition();
  const [removeTransitionPending, startRemoveTransition] = useTransition();
  const saving = reorderPending || removePending || reorderTransitionPending || removeTransitionPending;

  useEffect(() => {
    const state = removeState.status !== "idle" ? removeState : reorderState;

    if (state.status === "idle" || !state.message) {
      return;
    }

    const key = `${state.status}:${state.message}`;

    if (lastActionMessageRef.current === key) {
      return;
    }

    lastActionMessageRef.current = key;
    onToast({
      tone: state.status === "success" ? "success" : "error",
      message: state.status === "success" ? "Sequence updated." : state.message,
    });
  }, [onToast, removeState, reorderState]);

  const persistOrder = (nextLines: MonthlySequenceLineRecord[]) => {
    if (disabled || nextLines.length === 0) {
      return;
    }

    const formData = new FormData();
    formData.set("routeId", routeId);
    formData.set("sequenceMonth", sequenceMonth);
    nextLines.forEach((line) => formData.append("lineId", line.id));

    startReorderTransition(() => {
      reorderAction(formData);
    });
  };

  const reorderById = (sourceId: string, targetId: string) => {
    const nextLines = moveLine(lines, sourceId, targetId);

    if (nextLines === lines) {
      return;
    }

    setLines(nextLines);
    persistOrder(nextLines);
  };

  const moveByOffset = (lineId: string, offset: -1 | 1) => {
    const currentIndex = lines.findIndex((line) => line.id === lineId);
    const targetLine = lines[currentIndex + offset];

    if (!targetLine) {
      return;
    }

    reorderById(lineId, targetLine.id);
  };

  const confirmRemove = (formData: FormData) => {
    if (!lineToRemove) {
      return;
    }

    setLines((currentLines) => resequenceLocalLines(currentLines.filter((line) => line.id !== lineToRemove.id)));
    setLineToRemove(null);

    startRemoveTransition(() => {
      removeAction(formData);
    });
  };

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Sequence Sheet</h2>
            <p className="mt-0.5 text-sm text-text-secondary">{lines.length} customers</p>
          </div>
          <p className="text-xs font-medium text-text-secondary">Drag handle or use Arrow Up/Down from handle.</p>
        </div>

        {lines.length === 0 ? (
          <EmptyState message="No customers added for this route and month" />
        ) : (
          <div className="overflow-hidden rounded-md border border-surface-border bg-surface shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-[760px] w-full divide-y divide-surface-border">
                <thead className="bg-surface-muted/80">
                  <tr>
                    <th className="w-14 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                      Move
                    </th>
                    <th className="w-20 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                      Sr No
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                      Customer
                    </th>
                    <th className="w-24 px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border bg-surface">
                  {lines.map((line, index) => {
                    const isDragging = draggedLineId === line.id;
                    const isDragOver = dragOverLineId === line.id && draggedLineId !== line.id;
                    const isHighlighted = highlightedLineId === line.id;

                    return (
                      <tr
                        id={`sequence-row-${line.id}`}
                        key={line.id}
                        draggable={!disabled && !saving}
                        onDragStart={(event) => {
                          setDraggedLineId(line.id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", line.id);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          if (dragOverLineId !== line.id) {
                            setDragOverLineId(line.id);
                          }
                        }}
                        onDragLeave={() => setDragOverLineId(null)}
                        onDrop={(event) => {
                          event.preventDefault();
                          const sourceId = event.dataTransfer.getData("text/plain") || draggedLineId;

                          setDraggedLineId(null);
                          setDragOverLineId(null);

                          if (sourceId) {
                            reorderById(sourceId, line.id);
                          }
                        }}
                        onDragEnd={() => {
                          setDraggedLineId(null);
                          setDragOverLineId(null);
                        }}
                        className={cn(
                          "transition",
                          isDragging && "opacity-50",
                          isDragOver && "bg-accent-soft",
                          isHighlighted && "bg-amber-50",
                        )}
                      >
                        <td className="px-4 py-2.5 align-middle">
                          <IconButton
                            type="button"
                            disabled={disabled || saving}
                            className="cursor-grab text-text-muted"
                            aria-label={`Move ${line.customerName}`}
                            title="Drag to reorder. Use Arrow Up or Arrow Down from this handle."
                            onKeyDown={(event) => {
                              if (event.key === "ArrowUp") {
                                event.preventDefault();
                                moveByOffset(line.id, -1);
                              }

                              if (event.key === "ArrowDown") {
                                event.preventDefault();
                                moveByOffset(line.id, 1);
                              }
                            }}
                          >
                            <GripIcon className="h-5 w-5" />
                          </IconButton>
                        </td>
                        <td className="px-4 py-2.5 align-middle text-sm font-semibold text-text-secondary">{index + 1}</td>
                        <td className="px-4 py-2.5 align-middle">
                          <p className="text-[15px] font-semibold uppercase leading-5 text-text-primary">
                            {line.customerName}
                          </p>
                          <p className="mt-0.5 text-xs font-medium uppercase tracking-[0.12em] text-text-secondary">
                            {formatLineMeta(line) || "-"}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-right align-middle">
                          <IconButton
                            type="button"
                            tone="danger"
                            disabled={disabled || saving}
                            aria-label={`Remove ${line.customerName}`}
                            title="Remove customer"
                            onClick={() => setLineToRemove(line)}
                          >
                            <XIcon className="h-5 w-5" />
                          </IconButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(lineToRemove)}
        title="Remove customer from sequence?"
        description={
          lineToRemove
            ? `${lineToRemove.customerName} will be removed from this route/month sequence. Remaining rows will be renumbered automatically.`
            : undefined
        }
        confirmLabel="Remove"
        pending={removePending || removeTransitionPending}
        onClose={() => {
          if (!removePending && !removeTransitionPending) {
            setLineToRemove(null);
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          confirmRemove(new FormData(event.currentTarget));
        }}
      >
        <input type="hidden" name="routeId" value={routeId} readOnly />
        <input type="hidden" name="sequenceMonth" value={sequenceMonth} readOnly />
        <input type="hidden" name="lineId" value={lineToRemove?.id ?? ""} readOnly />
      </ConfirmDialog>

      {saving ? (
        <StickyActionBar>
          <span className="text-sm font-medium text-text-secondary">Saving sequence changes...</span>
        </StickyActionBar>
      ) : null}
    </>
  );
}

export function MonthlyRouteSequenceScreen({ payload }: { payload: MonthlyRouteSequencePayload }) {
  const [query, setQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [highlightedLineId, setHighlightedLineId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const lastAddMessageRef = useRef("");
  const formRef = useRef<HTMLFormElement>(null);
  const customerIdRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState(addMonthlyRouteSequenceLine, initialState);

  const showToast = useCallback((nextToast: ToastState) => {
    setToast(nextToast);
  }, []);

  const existingLineByCustomerId = useMemo(
    () => new Map(payload.lines.map((line) => [line.customerId, line])),
    [payload.lines],
  );

  const suggestions = useMemo(() => {
    const cleanQuery = query.trim();

    if (!payload.selectedRouteId) {
      return [];
    }

    if (!cleanQuery) {
      return payload.customers
        .filter((customer) => !existingLineByCustomerId.has(customer.id))
        .slice(0, 8);
    }

    return payload.customers.filter((customer) => matchesCustomer(customer, cleanQuery)).slice(0, 8);
  }, [existingLineByCustomerId, payload.customers, payload.selectedRouteId, query]);

  const canAdd = payload.dbConnected && Boolean(payload.selectedRouteId) && !payload.error && !pending;

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setToast(null), 2600);

    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (state.status === "idle" || !state.message) {
      return;
    }

    const key = `${state.status}:${state.message}`;

    if (lastAddMessageRef.current === key) {
      return;
    }

    lastAddMessageRef.current = key;
    showToast({
      tone: state.status === "success" ? "success" : "warning",
      message: state.status === "success" ? "Customer added to sequence." : state.message,
    });
    searchInputRef.current?.focus();
  }, [showToast, state.message, state.status]);

  const highlightExistingLine = (line: MonthlySequenceLineRecord) => {
    setHighlightedLineId(line.id);
    showToast({
      tone: "warning",
      message: "Customer is already in this sequence.",
    });
    window.setTimeout(() => {
      document.getElementById(`sequence-row-${line.id}`)?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }, 0);
    window.setTimeout(() => setHighlightedLineId(null), 2200);
  };

  const addCustomer = (customerId: string) => {
    const existingLine = existingLineByCustomerId.get(customerId);

    if (existingLine) {
      setSuggestionsOpen(false);
      highlightExistingLine(existingLine);
      searchInputRef.current?.focus();
      return;
    }

    if (!canAdd || !customerId) {
      return;
    }

    if (customerIdRef.current) {
      customerIdRef.current.value = customerId;
    }

    setQuery("");
    setSuggestionsOpen(false);
    setHighlightedIndex(0);
    formRef.current?.requestSubmit();
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  return (
    <>
      <RouteMonthToolbar payload={payload} />

      <form ref={formRef} action={formAction} className="hidden">
        <input type="hidden" name="routeId" value={payload.selectedRouteId} readOnly />
        <input type="hidden" name="sequenceMonth" value={payload.selectedMonth} readOnly />
        <input ref={customerIdRef} type="hidden" name="customerId" />
      </form>

      <AddCustomerBar
        query={query}
        suggestionsOpen={suggestionsOpen && canAdd}
        highlightedIndex={highlightedIndex}
        suggestions={suggestions}
        existingLineByCustomerId={existingLineByCustomerId}
        disabled={!canAdd}
        pending={pending}
        inputRef={searchInputRef}
        onQueryChange={setQuery}
        onSuggestionsOpenChange={setSuggestionsOpen}
        onHighlightedIndexChange={setHighlightedIndex}
        onAddCustomer={addCustomer}
        onOpenQuickCreate={() => setQuickCreateOpen(true)}
      />

      <SequenceTable
        key={`${payload.selectedRouteId}-${payload.selectedMonth}-${payload.lines
          .map((line) => `${line.id}:${line.sequenceNo}`)
          .join("|")}`}
        routeId={payload.selectedRouteId}
        sequenceMonth={payload.selectedMonth}
        initialLines={payload.lines}
        highlightedLineId={highlightedLineId}
        disabled={!payload.dbConnected || Boolean(payload.error)}
        onToast={showToast}
      />

      {toast ? <Toast tone={toast.tone}>{toast.message}</Toast> : null}

      {quickCreateOpen ? (
        <CustomerQuickCreateDialog
          open
          dbConnected={payload.dbConnected}
          title="Add customer to sequence"
          description="Create a new customer and add them to this route/month sequence."
          submitLabel="Create and add"
          defaultName={query.trim()}
          hiddenFields={[
            { name: "routeId", value: payload.selectedRouteId },
            { name: "sequenceMonth", value: payload.selectedMonth },
          ]}
          action={createCustomerAndAddToMonthlyRouteSequence}
          onClose={() => setQuickCreateOpen(false)}
          onSuccess={() => {
            setQuery("");
            setHighlightedIndex(0);
            showToast({
              tone: "success",
              message: "Customer created and added to sequence.",
            });
            window.setTimeout(() => searchInputRef.current?.focus(), 0);
          }}
        />
      ) : null}
    </>
  );
}
