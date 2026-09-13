"use client";

import { Fragment, useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { DailyEntryPayload } from "@/lib/daily-entry";
import {
  revertMonthBillsToDraft,
  saveDailyEntry,
  type DailyEntryActionState,
} from "@/app/daily-entry/actions";
import {
  DoorstepPaymentDialog,
  type DoorstepPaymentTarget,
} from "@/app/daily-entry/doorstep-payment-dialog";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { usePageMetric } from "@/components/admin/page-metric";
import { Toast, type ToastTone } from "@/components/admin/toast";
import { cn } from "@/lib/utils";

const initialState: DailyEntryActionState = { status: "idle" };

const ACTIONS_PREFERENCE = "daily-entry-show-actions";

type ToastState = {
  tone: ToastTone;
  message: string;
};

type Totals = {
  perProduct: Map<string, number>;
  grandAmount: number;
};

type ExtraRow = {
  key: string;
  customerId: string;
  productId: string;
  quantity: string;
  rate: string;
};

function ActionMessage({ state }: { state: DailyEntryActionState }) {
  if (state.status === "idle" || !state.message) {
    return null;
  }

  return (
    <p className={`text-sm ${state.status === "success" ? "text-emerald-700" : "text-rose-700"}`}>{state.message}</p>
  );
}

function formatQty(value: number) {
  return value % 1 === 0 ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function DailyEntryScreen({ payload }: { payload: DailyEntryPayload }) {
  const [state, formAction, pending] = useActionState(saveDailyEntry, initialState);
  const [revertState, revertAction, revertPending] = useActionState(revertMonthBillsToDraft, initialState);

  const toolbarFormRef = useRef<HTMLFormElement>(null);
  const entryFormRef = useRef<HTMLFormElement>(null);

  usePageMetric(
    payload.lines.length > 0
      ? { label: "Customers", value: String(payload.lines.length) }
      : null,
  );

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

  // Whether the at-the-door column is showing. A per-operator preference rather
  // than a setting: it costs horizontal room on a wide round, and somebody
  // entering quantities at speed may want it out of the way today and back
  // tomorrow. Remembered in the browser, so it survives a reload without a
  // server round trip.
  //
  // Hiding the column hides the BUTTONS, never the data: an occasional sale
  // already recorded still shows under its customer, because a figure that
  // vanishes from a screen is how money goes missing.
  // Off unless asked for. Most rounds are milk and quantities, and the column
  // costs width on a grid that is already wide — so it is opt-in, and the
  // choice is remembered.
  //
  // Hidden on every render, server and first client paint alike, then synced
  // from the saved preference right after mount — the same shape the sidebar's
  // collapsed state uses, for the same reason: reading it in the initializer
  // would desync the server-rendered HTML from the first client render.
  const [showActions, setShowActions] = useState(false);
  const [payingCustomer, setPayingCustomer] = useState<DoorstepPaymentTarget | null>(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(ACTIONS_PREFERENCE) === "shown") {
        // Reading an external system once on mount, not syncing derived state
        // — the carve-out react-hooks/set-state-in-effect's own guidance makes.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShowActions(true);
      }
    } catch {
      // Private windows and blocked site data both throw; the default stands.
    }
  }, []);

  const toggleActions = (next: boolean) => {
    setShowActions(next);
    try {
      window.localStorage.setItem(ACTIONS_PREFERENCE, next ? "shown" : "hidden");
    } catch {
      // Not being able to remember the choice is no reason to refuse it.
    }
  };

  // Occasional sales, per customer. These are rows rather than columns: a kilo
  // of paneer belongs to the one customer who bought it, not to a column
  // standing empty against the other six hundred.
  //
  // Seeded from what is already saved, and ALWAYS posted back — a save rebuilds
  // every line's product rows from what it receives, so an item left out here
  // would be deleted by the next save of this round.
  const [extraRows, setExtraRows] = useState<ExtraRow[]>(() =>
    payload.lines.flatMap((line) =>
      line.extraItems.map((item) => ({
        key: `${line.customerId}:${item.productId}`,
        customerId: line.customerId,
        productId: item.productId,
        quantity: item.quantity,
        rate: item.rate,
      })),
    ),
  );

  // Derived, not toggled. Adding a row and removing it again leaves the form
  // exactly as it was found, and the Save button has to agree — a flag set on
  // add and never cleared on remove was offering to save nothing.
  const extraSignature = (rows: ExtraRow[]) =>
    rows
      .map((row) => `${row.customerId}:${row.productId}:${Number(row.quantity)}:${Number(row.rate)}`)
      .sort()
      .join("|");

  const savedExtras = useMemo(
    () =>
      extraSignature(
        payload.lines.flatMap((line) =>
          line.extraItems.map((item) => ({
            key: "",
            customerId: line.customerId,
            productId: item.productId,
            quantity: item.quantity,
            rate: item.rate,
          })),
        ),
      ),
    [payload.lines],
  );
  // Moves forward on a successful save so Save settles again without a reload.
  // Adjusted during render rather than in an effect — the codebase's usual
  // shape for state that follows an action result, and the only one the hooks
  // rules allow here (no setState inside an effect, no refs read while
  // rendering).
  const [savedExtrasBaseline, setSavedExtrasBaseline] = useState(savedExtras);
  const [settledSaveKey, setSettledSaveKey] = useState<string | null>(null);
  const saveKey =
    state.status === "success" && state.message ? `${state.status}:${state.message}` : null;

  if (saveKey && saveKey !== settledSaveKey) {
    setSettledSaveKey(saveKey);
    setSavedExtrasBaseline(extraSignature(extraRows));
  }

  const extrasDirty = extraSignature(extraRows) !== savedExtrasBaseline;
  const extrasAmount = extraRows.reduce(
    (total, row) => total + Number(row.quantity || 0) * Number(row.rate || 0),
    0,
  );

  const addExtraRow = (customerId: string) => {
    const product = payload.occasionalProducts[0];

    if (!product) {
      return;
    }

    setExtraRows((rows) => [
      ...rows,
      {
        key: `${customerId}:new:${crypto.randomUUID()}`,
        customerId,
        productId: product.id,
        quantity: "0",
        rate: product.defaultRate,
      },
    ]);
  };

  const updateExtraRow = (key: string, patch: Partial<ExtraRow>) => {
    setExtraRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const removeExtraRow = (key: string) => {
    setExtraRows((rows) => rows.filter((row) => row.key !== key));
  };

  // Quantity inputs are uncontrolled (defaultValue) for performance with
  // large routes — recomputing totals/dirty state via a single delegated
  // input listener over the DOM avoids re-rendering every cell on every
  // keystroke, which a fully controlled table of inputs would require.
  const recompute = () => {
    const inputs = entryFormRef.current?.querySelectorAll<HTMLInputElement>("[data-daily-entry-quantity='true']");

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

  // Applies each customer's usual order to the cells still sitting at 0.
  // Deliberately does NOT overwrite a value someone has already typed, and is
  // never automatic — an operator has to ask for it, so nobody saves last
  // week's quantities as today's delivery by tabbing past them.
  const fillUsual = () => {
    const inputs = entryFormRef.current?.querySelectorAll<HTMLInputElement>(
      "[data-daily-entry-quantity='true']",
    );

    if (!inputs) {
      return;
    }

    inputs.forEach((input) => {
      const usual = Number(input.dataset.lastQuantity ?? "0");

      if (usual > 0 && Number(input.value || 0) === 0) {
        input.value = String(usual);
      }
    });

    recompute();
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
      const inputs = entryFormRef.current?.querySelectorAll<HTMLInputElement>("[data-daily-entry-quantity='true']");
      inputs?.forEach((input) => {
        input.dataset.originalValue = input.value;
      });
      recompute();
    }
  }, [state.message, state.status]);

  const lastRevertMessageRef = useRef("");
  useEffect(() => {
    if (revertState.status === "idle" || !revertState.message) {
      return;
    }

    const key = `${revertState.status}:${revertState.message}`;
    if (lastRevertMessageRef.current === key) {
      return;
    }

    lastRevertMessageRef.current = key;
    setToast({
      tone: revertState.status === "success" ? "success" : "error",
      message: revertState.message,
    });
  }, [revertState.message, revertState.status]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setToast(null), 2600);

    return () => window.clearTimeout(timeout);
  }, [toast]);

  // The save guard blocked us because this route+month has Generated/Locked
  // bills; offer the one-click revert until it's actually cleared.
  const showRevertBanner = state.blockedByBill === true && revertState.status !== "success";

  const dirty = isDirty || extrasDirty;
  const canSave = payload.lines.length > 0 && dirty && !pending;

  return (
    <div className="space-y-4">
      <div className="sticky top-[65px] z-10 -mx-4 border-surface-border bg-app-bg/95 px-4 backdrop-blur transition-colors duration-200 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
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
          {payload.lines.length > 0 ? (
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-secondary transition hover:bg-surface-muted">
              <input
                type="checkbox"
                checked={showActions}
                onChange={(event) => toggleActions(event.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              At the door
            </label>
          ) : null}
          <SecondaryButton
            type="button"
            onClick={fillUsual}
            disabled={payload.lines.length === 0}
            className="h-10 px-4 text-sm font-medium"
            title="Fill every empty cell with what that customer usually takes on this route"
          >
            Fill usual
          </SecondaryButton>
          <PrimaryButton
            type="submit"
            form="daily-entry-form"
            disabled={!canSave}
            className="h-10 rounded-md px-5 text-sm font-semibold"
          >
            {pending ? "Saving..." : dirty ? "Save changes" : "Saved"}
          </PrimaryButton>
        </div>
      </div>

      {showRevertBanner ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="flex-1">{state.message}</span>
          <form action={revertAction}>
            <input type="hidden" name="routeId" value={payload.selectedRouteId} readOnly />
            <input type="hidden" name="entryDate" value={payload.selectedDate} readOnly />
            <SecondaryButton type="submit" disabled={revertPending} className="h-9 px-4 text-sm font-medium">
              {revertPending ? "Reverting..." : "Revert bills to Draft"}
            </SecondaryButton>
          </form>
        </div>
      ) : null}

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
            // focus() alone scrolls only far enough to make the input barely
            // visible, which puts it under the sticky toolbar near the end of a
            // long route. Centring keeps the row being typed into — and the
            // ones on either side — actually readable.
            nextInput.scrollIntoView({ block: "center", behavior: "smooth" });
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
            <div className="max-h-[calc(100vh-13rem)] overflow-auto">
              <table className="min-w-full divide-y divide-surface-border">
                <thead className="sticky top-0 z-10 bg-surface-muted">
                  <tr>
                    <th className="w-16 bg-surface-muted px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                      SR
                    </th>
                    <th className="min-w-[220px] bg-surface-muted px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                      Customer Name
                    </th>
                    {productColumns.map((product) => (
                      <th
                        key={product.productId}
                        title={product.productName}
                        className="min-w-[110px] bg-surface-muted px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary"
                      >
                        {product.productShortName ?? product.productName}
                      </th>
                    ))}
                    {/* Everything an operator does for one customer beyond
                        typing a quantity — sold at the door, collected at the
                        door. One fixed place at the end of the row, so the
                        hand goes to the same spot on every line. */}
                    {showActions ? (
                      <th className="w-28 bg-surface-muted px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                        At the door
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border bg-surface">
                  {payload.lines.map((line) => {
                    const productMap = new Map(line.products.map((product) => [product.productId, product]));
                    const lineExtras = extraRows.filter((row) => row.customerId === line.customerId);

                    return (
                      <Fragment key={line.customerId}>
                      <tr>
                        <td className="px-5 py-3.5 text-[1.05rem] font-medium text-text-secondary">
                          {line.sequenceNo}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="text-sm font-semibold uppercase text-text-primary">{line.customerName}</div>
                          <div className="text-xs text-text-secondary">{line.customerCode}</div>
                          <input type="hidden" name="customerId" value={line.customerId} readOnly />
                          <input type="hidden" name="sequenceNo" value={line.sequenceNo} readOnly />
                          <input type="hidden" name="remarks" value={line.remarks} readOnly />

                        </td>
                        {productColumns.map((column) => {
                          const product = productMap.get(column.productId);

                          return (
                            <td key={`${line.customerId}-${column.productId}`} className="px-5 py-3.5">
                              <input type="hidden" name="productId" value={column.productId} readOnly />
                              <input type="hidden" name="productCustomerId" value={line.customerId} readOnly />
                              <input type="hidden" name="rateSnapshot" value={product?.defaultRate ?? "0"} readOnly />
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
                                data-last-quantity={product?.lastQuantity ?? "0"}
                                // The quantity is NOT prefilled — every cell
                                // starts at 0 and the highlight alone says
                                // "this is a product they normally take", so
                                // nobody saves last week's numbers by tabbing
                                // past. Hovering gives the actual figure, and
                                // "Fill usual" applies them deliberately.
                                title={
                                  Number(product?.lastQuantity ?? 0) > 0
                                    ? `Usually takes ${formatQty(Number(product?.lastQuantity ?? 0))}`
                                    : undefined
                                }
                                className={cn(
                                  "h-10 w-20 rounded-md border px-2 text-sm text-text-primary outline-none transition focus:border-accent",
                                  Number(product?.lastQuantity ?? 0) > 0
                                    ? "border-accent/60 bg-accent/5"
                                    : "border-surface-border-strong bg-surface",
                                )}
                              />
                            </td>
                          );
                        })}
                        {showActions ? (
                        <td className="px-5 py-3.5">
                          {/* Only where there is something to add — a city with
                              every product on the grid has no occasional items,
                              and an empty picker is worse than no button. */}
                          {payload.occasionalProducts.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => addExtraRow(line.customerId)}
                              title={`Sell a one-off item to ${line.customerName}`}
                              className="inline-flex h-8 items-center gap-1 rounded-md border border-surface-border-strong bg-surface px-2.5 text-xs font-semibold text-accent transition hover:bg-surface-muted"
                            >
                              <span aria-hidden>+</span> Item
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() =>
                              setPayingCustomer({
                                customerId: line.customerId,
                                customerName: line.customerName,
                                customerCode: line.customerCode,
                              })
                            }
                            title={`Take a payment from ${line.customerName}`}
                            className="ml-1.5 inline-flex h-8 items-center gap-1 rounded-md border border-surface-border-strong bg-surface px-2.5 text-xs font-semibold text-accent transition hover:bg-surface-muted"
                          >
                            <span aria-hidden>₹</span> Pay
                          </button>
                        </td>
                        ) : null}
                      </tr>

                      {/* One row per occasional sale, directly under the
                          customer who bought it. The rate is typed, because the
                          whole point of these is a price agreed at the door. */}
                      {lineExtras.map((row) => {
                        const product = payload.occasionalProducts.find(
                          (item) => item.id === row.productId,
                        );

                        return (
                          <tr key={row.key} className="bg-surface-muted/40">
                            <td className="px-5 py-2" />
                            <td className="px-5 py-2" colSpan={productColumns.length + (showActions ? 2 : 1)}>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-text-secondary">&#8627;</span>
                                <select
                                  value={row.productId}
                                  onChange={(event) => {
                                    const next = payload.occasionalProducts.find(
                                      (item) => item.id === event.target.value,
                                    );
                                    updateExtraRow(row.key, {
                                      productId: event.target.value,
                                      // Follow the new product's rate unless one
                                      // has already been typed for this row.
                                      rate: next?.defaultRate ?? row.rate,
                                    });
                                  }}
                                  className="h-9 rounded-md border border-surface-border-strong bg-surface px-2 text-sm text-text-primary outline-none focus:border-accent"
                                  aria-label={`Item for ${line.customerName}`}
                                >
                                  {payload.occasionalProducts.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.name}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  name="quantity"
                                  type="number"
                                  step="0.001"
                                  min="0"
                                  value={row.quantity}
                                  onChange={(event) =>
                                    updateExtraRow(row.key, { quantity: event.target.value })
                                  }
                                  aria-label={`Quantity of ${product?.name ?? "item"} for ${line.customerName}`}
                                  className="h-9 w-20 rounded-md border border-surface-border-strong bg-surface px-2 text-sm text-text-primary outline-none focus:border-accent"
                                />
                                <span className="text-xs text-text-secondary">{product?.unit}</span>
                                <span className="text-sm text-text-secondary">&#215;</span>
                                <span className="text-sm text-text-secondary">&#8377;</span>
                                <input
                                  name="rateSnapshot"
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={row.rate}
                                  onChange={(event) =>
                                    updateExtraRow(row.key, { rate: event.target.value })
                                  }
                                  aria-label={`Rate for ${product?.name ?? "item"} for ${line.customerName}`}
                                  className="h-9 w-24 rounded-md border border-surface-border-strong bg-surface px-2 text-sm text-text-primary outline-none focus:border-accent"
                                />
                                <input
                                  type="hidden"
                                  name="productId"
                                  value={row.productId}
                                  readOnly
                                />
                                <input
                                  type="hidden"
                                  name="productCustomerId"
                                  value={line.customerId}
                                  readOnly
                                />
                                <button
                                  type="button"
                                  onClick={() => removeExtraRow(row.key)}
                                  className="text-xs font-semibold text-rose-700 underline underline-offset-2"
                                >
                                  Remove
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 z-10">
                  <tr className="border-t-2 border-surface-border-strong">
                    <td
                      className="bg-surface-muted px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary"
                      colSpan={2}
                    >
                      Total
                    </td>
                    {productColumns.map((column) => (
                      <td
                        key={column.productId}
                        className="bg-surface-muted px-5 py-3 text-sm font-semibold text-text-primary"
                      >
                        {formatQty(totals.perProduct.get(column.productId) ?? 0)}
                      </td>
                    ))}
                    {showActions ? <td className="bg-surface-muted px-5 py-3" /> : null}
                  </tr>
                  <tr className="border-t border-surface-border">
                    <td className="bg-surface-muted px-5 py-2.5 text-right text-sm" colSpan={productColumns.length + (showActions ? 3 : 2)}>
                      <span className="text-text-secondary">Total amount</span>{" "}
                      <span className="ml-1 font-semibold text-text-primary">
                        ₹{(totals.grandAmount + extrasAmount).toFixed(2)}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        <ActionMessage state={state} />
      </form>

      {/* Outside the form above: nesting one form in another is invalid, and a
          payment has to save on its own — never lost because the sheet failed
          validation, never re-sent when the sheet is saved again. */}
      <DoorstepPaymentDialog
        target={payingCustomer}
        routeId={payload.selectedRouteId}
        paymentDate={payload.selectedDate}
        onClose={() => setPayingCustomer(null)}
        onRecorded={(message) => setToast({ tone: "success", message })}
      />

      {toast ? <Toast tone={toast.tone}>{toast.message}</Toast> : null}
    </div>
  );
}
