"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { DailyEntryPayload } from "@/lib/daily-entry";
import {
  saveDailyEntry,
  type DailyEntryActionState,
} from "@/app/daily-entry/actions";
import { PrimaryButton } from "@/components/admin/buttons";
import { Toast, type ToastTone } from "@/components/admin/toast";
import { cn } from "@/lib/utils";

const initialState: DailyEntryActionState = { status: "idle" };

type ToastState = {
  tone: ToastTone;
  message: string;
};

type Totals = {
  perProduct: Map<string, number>;
  grandAmount: number;
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

function formatQty(value: number) {
  return value % 1 === 0 ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function DailyEntryScreen({ payload }: { payload: DailyEntryPayload }) {
  const [state, formAction, pending] = useActionState(saveDailyEntry, initialState);

  const toolbarFormRef = useRef<HTMLFormElement>(null);
  const entryFormRef = useRef<HTMLFormElement>(null);

  const productColumns = useMemo(
    () =>
      Array.from(
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
      ),
    [payload.lines],
  );

  const initialTotals = useMemo<Totals>(() => {
    const perProduct = new Map<string, number>();
    let grandAmount = 0;

    payload.lines.forEach((line) => {
      const productMap = new Map(line.products.map((product) => [product.productId, product]));

      productColumns.forEach((column) => {
        const product = productMap.get(column.productId);
        const qty = Number(product?.quantity ?? 0);
        const rate = Number(product?.defaultRate ?? 0);
        perProduct.set(column.productId, (perProduct.get(column.productId) ?? 0) + qty);
        grandAmount += qty * rate;
      });
    });

    return { perProduct, grandAmount };
  }, [payload.lines, productColumns]);

  // Lazy initializer only — payload.selectedRouteId/selectedDate changes
  // always go through a full form GET navigation (see the toolbar form
  // below), which is a real browser navigation, not a soft client
  // transition. That guarantees a fresh mount with a fresh payload rather
  // than this component receiving a new payload prop while staying
  // mounted, so there's no case where these need to re-sync after mount.
  const [totals, setTotals] = useState<Totals>(() => initialTotals);
  const [isDirty, setIsDirty] = useState(false);

  // Quantity inputs are uncontrolled (defaultValue) for performance with
  // large routes — recomputing totals/dirty state via a single delegated
  // input listener over the DOM avoids re-rendering every cell on every
  // keystroke, which a fully controlled table of inputs would require.
  const recompute = () => {
    const inputs = entryFormRef.current?.querySelectorAll<HTMLInputElement>(
      "[data-daily-entry-quantity='true']",
    );

    if (!inputs) {
      return;
    }

    let dirty = false;
    const perProduct = new Map<string, number>();
    let grandAmount = 0;

    inputs.forEach((input) => {
      const current = Number(input.value || 0);
      const original = Number(input.dataset.originalValue ?? "0");
      const rate = Number(input.dataset.rate ?? "0");
      const productId = input.dataset.productId ?? "";

      if (current !== original) {
        dirty = true;
      }

      perProduct.set(productId, (perProduct.get(productId) ?? 0) + current);
      grandAmount += current * rate;
    });

    setIsDirty(dirty);
    setTotals({ perProduct, grandAmount });
  };

  const lastMessageRef = useRef("");
  const [toast, setToast] = useState<ToastState | null>(null);

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

    if (state.status === "success") {
      // Whatever is on screen right now is what was just saved — reset the
      // dirty baseline to it instead of waiting on a full page reload, so
      // Save immediately disables again until the next real change.
      const inputs = entryFormRef.current?.querySelectorAll<HTMLInputElement>(
        "[data-daily-entry-quantity='true']",
      );
      inputs?.forEach((input) => {
        input.dataset.originalValue = input.value;
      });
      recompute();
    }
  }, [state.message, state.status]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setToast(null), 2600);

    return () => window.clearTimeout(timeout);
  }, [toast]);

  const canSave = payload.lines.length > 0 && isDirty && !pending;

  return (
    <div className="space-y-4">
      <div className="sticky top-[73px] z-10 -mx-4 border-b border-surface-border bg-app-bg/95 px-4 py-3 backdrop-blur transition-colors duration-200 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <form ref={toolbarFormRef} action="/daily-entry" className="flex flex-wrap items-center gap-3">
            <input
              name="entryDate"
              type="date"
              defaultValue={payload.selectedDate}
              onChange={() => toolbarFormRef.current?.requestSubmit()}
              className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            />
            <select
              name="routeId"
              defaultValue={payload.selectedRouteId}
              onChange={() => toolbarFormRef.current?.requestSubmit()}
              className="h-10 min-w-72 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            >
              {payload.routes.length === 0 ? (
                <option value="">Select route</option>
              ) : (
                payload.routes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.name}
                  </option>
                ))
              )}
            </select>
          </form>
          <PrimaryButton
            type="submit"
            form="daily-entry-form"
            disabled={!canSave}
            className="h-10 rounded-md px-5 text-sm font-semibold"
          >
            {pending ? "Saving..." : isDirty ? "Save changes" : "Saved"}
          </PrimaryButton>
        </div>
      </div>

      <form
        id="daily-entry-form"
        ref={entryFormRef}
        action={formAction}
        className="space-y-4"
        onInput={(event) => {
          if ((event.target as HTMLElement).dataset.dailyEntryQuantity === "true") {
            recompute();
          }
        }}
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
                    <th className="min-w-[220px] px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                      Customer Name
                    </th>
                    {productColumns.map((product) => (
                      <th
                        key={product.productId}
                        title={product.productName}
                        className="min-w-[110px] px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary"
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
                                data-original-value={product?.quantity ?? "0"}
                                data-product-id={column.productId}
                                data-rate={product?.defaultRate ?? "0"}
                                className={cn(
                                  "h-10 w-20 rounded-md border border-surface-border-strong bg-surface px-2 text-sm text-text-primary outline-none transition focus:border-accent",
                                )}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-surface-border-strong bg-surface-muted">
                  <tr>
                    <td className="px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary" colSpan={2}>
                      Total
                    </td>
                    {productColumns.map((column) => (
                      <td key={column.productId} className="px-5 py-3 text-sm font-semibold text-text-primary">
                        {formatQty(totals.perProduct.get(column.productId) ?? 0)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-surface-border bg-surface-muted px-5 py-3 text-sm">
              <span className="text-text-secondary">Total amount</span>
              <span className="font-semibold text-text-primary">
                ₹{totals.grandAmount.toFixed(2)}
              </span>
            </div>
          </div>
        )}

        <ActionMessage state={state} />
        {toast ? <Toast tone={toast.tone}>{toast.message}</Toast> : null}
      </form>
    </div>
  );
}
