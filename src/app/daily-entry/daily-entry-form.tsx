"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { DailyEntryPayload } from "@/lib/daily-entry";
import {
  saveDailyEntry,
  type DailyEntryActionState,
} from "@/app/daily-entry/actions";
import { cn } from "@/lib/utils";

const initialState: DailyEntryActionState = { status: "idle" };

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
        <div className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
          <p className="text-sm font-medium text-slate-700">
            No monthly sequence found for the selected route and date.
          </p>
          <p className="mt-1 text-sm text-slate-500">
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
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-100">
                <tr>
                  <th className="w-16 px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    SR
                  </th>
                  <th className="min-w-[280px] px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Customer Name
                  </th>
                  {productColumns.map((product) => (
                    <th
                      key={product.productId}
                      title={product.productName}
                      className="min-w-[180px] px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500"
                    >
                      {product.productShortName ?? product.productName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {payload.lines.map((line) => {
                  const productMap = new Map(
                    line.products.map((product) => [product.productId, product]),
                  );

                  return (
                    <tr key={line.customerId}>
                      <td className="px-5 py-3.5 text-[1.05rem] font-medium text-slate-500">
                        {line.sequenceNo}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="text-sm font-semibold uppercase text-slate-900">
                          {line.customerName}
                        </div>
                        <div className="text-xs text-slate-500">{line.customerCode}</div>
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
                                "h-10 w-36 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-600",
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
      {pending ? <div className="text-sm text-slate-500">Saving...</div> : null}
    </form>
  );
}
