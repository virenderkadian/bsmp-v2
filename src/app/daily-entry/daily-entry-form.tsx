"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DailyEntryPayload } from "@/lib/daily-entry";
import {
  saveDailyEntry,
  type DailyEntryActionState,
} from "@/app/daily-entry/actions";
import { Toast, type ToastTone } from "@/components/admin/toast";
import { cn } from "@/lib/utils";

const initialState: DailyEntryActionState = { status: "idle" };

type ToastState = {
  tone: ToastTone;
  message: string;
};

function ActionMessage({ state }: { state: DailyEntryActionState }) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  return (
    <p
      className={`text-sm ${
        state.status === "success" ? "text-emerald-700" : "text-rose-700"
      }`}
    >
      {state.message}
    </p>
  );
}

export function DailyEntryForm({ payload }: { payload: DailyEntryPayload }) {
  const [state, formAction, pending] = useActionState(saveDailyEntry, initialState);

  // Save All lives in the page header, well above this (often long) table —
  // a plain inline message at the bottom of the form is easy to miss
  // entirely after clicking it. A toast is fixed-position, so it's visible
  // regardless of scroll position or how many customers are on this route.
  const [toast, setToast] = useState<ToastState | null>(null);
  const lastMessageRef = useRef("");

  useEffect(() => {
    if (state.status === "idle" || !state.message) {
      return;
    }

    const key = `${state.status}:${state.message}`;

    if (lastMessageRef.current === key) {
      return;
    }

    lastMessageRef.current = key;
    setToast({ tone: state.status === "success" ? "success" : "error", message: state.message });
  }, [state.message, state.status]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setToast(null), 2600);

    return () => window.clearTimeout(timeout);
  }, [toast]);
  const productColumns = Array.from(
    new Map(
      payload.lines.flatMap((line) =>
        line.products.map((product) => [
          product.productId,
          {
            productId: product.productId,
            productName: product.productName,
            productShortName: product.productShortName,
            productCode: product.productCode,
          },
        ]),
      ),
    ).values(),
  );

  return (
    <form
      id="daily-entry-form"
      action={formAction}
      className="space-y-4"
      onKeyDown={(event) => {
        if (event.key !== "Enter") {
          return;
        }

        const target = event.target;

        if (!(target instanceof HTMLInputElement) || target.dataset.dailyEntryQuantity !== "true") {
          return;
        }

        event.preventDefault();

        const quantityInputs = Array.from(
          event.currentTarget.querySelectorAll<HTMLInputElement>("[data-daily-entry-quantity='true']"),
        );
        const currentIndex = quantityInputs.indexOf(target);
        const nextInput = quantityInputs[currentIndex + 1];

        if (nextInput) {
          nextInput.focus();
          nextInput.select();
          return;
        }

        event.currentTarget.requestSubmit();
      }}
    >
      <input type="hidden" name="routeId" value={payload.selectedRouteId} readOnly />
      <input type="hidden" name="entryDate" value={payload.selectedDate} readOnly />
      <input type="hidden" name="notes" value={payload.notes} readOnly />

      {payload.lines.length === 0 ? (
        <div className="rounded-md border border-dashed border-surface-border-strong bg-surface px-4 py-10 text-center">
          <p className="text-sm font-medium text-text-primary">
            No monthly sequence found for the selected route and date.
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            Add customers in Route Sequence for this route/month, then reload Daily Entry.
          </p>
          <Link
            href="/monthly-route-sequence"
            className="mt-4 inline-flex h-10 items-center justify-center rounded-md border border-blue-600 bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Open Route Sequence
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-surface-border bg-surface shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-surface-border">
              <thead className="bg-surface-muted">
                <tr>
                  <th className="w-16 px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                    SR
                  </th>
                  <th className="min-w-[280px] px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                    Customer Name
                  </th>
                  {productColumns.map((product) => (
                    <th
                      key={product.productId}
                      title={product.productName}
                      className="min-w-[180px] px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary"
                    >
                      {product.productShortName ?? product.productName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border bg-surface">
                {payload.lines.map((line) => {
                  const productMap = new Map(
                    line.products.map((product) => [product.productId, product]),
                  );

                  return (
                    <tr key={line.customerId}>
                      <td className="px-5 py-3.5 text-[1.05rem] font-medium text-text-secondary">
                        {line.sequenceNo}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="text-sm font-semibold uppercase text-text-primary">
                          {line.customerName}
                        </div>
                        <div className="text-xs text-text-secondary">{line.customerCode}</div>
                        <input type="hidden" name="customerId" value={line.customerId} readOnly />
                        <input type="hidden" name="sequenceNo" value={line.sequenceNo} readOnly />
                        <input type="hidden" name="remarks" value={line.remarks} readOnly />
                      </td>
                      {productColumns.map((column) => {
                        const product = productMap.get(column.productId);

                        return (
                          <td key={`${line.customerId}-${column.productId}`} className="px-5 py-3.5">
                            <input
                              type="hidden"
                              name="productId"
                              value={column.productId}
                              readOnly
                            />
                            <input
                              type="hidden"
                              name="productCustomerId"
                              value={line.customerId}
                              readOnly
                            />
                            <input
                              type="hidden"
                              name="rateSnapshot"
                              value={product?.defaultRate ?? "0"}
                              readOnly
                            />
                            <input
                              name="quantity"
                              type="number"
                              step="0.001"
                              min="0"
                              defaultValue={product?.quantity ?? "0"}
                              data-daily-entry-quantity="true"
                              className={cn(
                                "h-10 w-36 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent",
                              )}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ActionMessage state={state} />
      {pending ? <div className="text-sm text-text-secondary">Saving...</div> : null}
      {toast ? <Toast tone={toast.tone}>{toast.message}</Toast> : null}
    </form>
  );
}
