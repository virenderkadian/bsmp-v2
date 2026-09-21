"use client";

import { Fragment, useActionState, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
import { Dialog } from "@/components/admin/dialog";
import { usePageMetric } from "@/components/admin/page-metric";
import { Toast, type ToastTone } from "@/components/admin/toast";
import { isQuantityUnusual } from "@/lib/quantity-baseline";
import { cn } from "@/lib/utils";

const initialState: DailyEntryActionState = { status: "idle" };

const ACTIONS_PREFERENCE = "daily-entry-show-actions";

// Amber, not the blue used for "usual product" — this flags the TYPED value
// itself as worth a second look, a different signal from "they normally buy
// this at all".
const UNUSUAL_QUANTITY_CLASSES = ["border-amber-500", "bg-amber-50", "ring-1", "ring-amber-400"];

// Module-level (not component-scoped) so the focus/scroll effect below can
// use them with a stable identity and an empty dependency array, instead of
// re-registering its listeners on every keystroke's re-render.
//
// Reads a cell's current value and its server-provided history data, applies
// the unusual/usual visual state directly to the input (classes + title),
// and returns the same text so the always-visible focus tooltip can show it
// without recomputing anything.
function applyQuantityState(input: HTMLInputElement) {
  const current = Number(input.value || 0);
  const bandMin = input.dataset.bandMin;
  const bandMax = input.dataset.bandMax;
  const band = bandMin && bandMax ? { median: 0, min: Number(bandMin), max: Number(bandMax) } : null;
  const recentQuantities = (input.dataset.recentQuantities || "")
    .split(",")
    .filter(Boolean)
    .map(Number);
  const unusual = isQuantityUnusual(current, band, recentQuantities);

  UNUSUAL_QUANTITY_CLASSES.forEach((cls) => input.classList.toggle(cls, unusual));

  // Mode over the raw last-delivered quantity: a real number this customer
  // has actually ordered more than once, not just whatever they happened to
  // take most recently.
  const modeQuantity = input.dataset.modeQuantity;
  const usualQuantity = modeQuantity ? Number(modeQuantity) : Number(input.dataset.lastQuantity ?? 0);
  const usualText = usualQuantity > 0 ? `Usually takes ${formatQty(usualQuantity)}` : "";
  const text = unusual
    ? usualText
      ? `Unusual — ${usualText.toLowerCase()}`
      : "Unusual — different from their recent orders"
    : usualText;

  input.title = text;
  return { unusual, text };
}

// The tooltip is one shared, fixed-position element reused across every
// cell — not one per cell — so showing it is just repositioning and
// restyling a single node, matching this screen's usual grid-scale-friendly
// approach of touching the DOM directly instead of per-cell React state.
function showQuantityTooltip(tooltip: HTMLDivElement, input: HTMLInputElement, unusual: boolean, text: string) {
  if (!text) {
    tooltip.classList.add("hidden");
    return;
  }

  tooltip.textContent = text;
  tooltip.classList.toggle("border-amber-400", unusual);
  tooltip.classList.toggle("bg-amber-50", unusual);
  tooltip.classList.toggle("text-amber-900", unusual);
  tooltip.classList.toggle("border-surface-border-strong", !unusual);
  tooltip.classList.toggle("bg-surface", !unusual);
  tooltip.classList.toggle("text-text-primary", !unusual);

  const rect = input.getBoundingClientRect();
  tooltip.style.left = `${rect.left}px`;
  tooltip.style.top = `${rect.bottom + 6}px`;
  tooltip.classList.remove("hidden");
}

type ToastState = {
  tone: ToastTone;
  message: string;
};

type Totals = {
  perProduct: Map<string, number>;
  grandAmount: number;
};

type UnusualCell = {
  customerName: string;
  productLabel: string;
  quantity: number;
  detail: string;
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
  const activeCellTooltipRef = useRef<HTMLDivElement>(null);

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

  // Cells currently flagged unusual, keyed by customer+product — tracked in
  // state (not just DOM classes) so the save flow can show exactly which
  // ones, and gate the submit on the operator actually confirming them.
  // Rebuilt on every recompute(), which already runs on every keystroke, so
  // this rides an existing re-render rather than adding a new one.
  const [unusualCells, setUnusualCells] = useState<Map<string, UnusualCell>>(new Map());
  // Whether the confirm dialog is open. Caught client-side, before the form
  // ever submits (see the form's onSubmit below) — an earlier version let
  // the save reach the server and rendered the warning inline at the bottom
  // of the page. That read as disconnected from the actual Save click (easy
  // to scroll past, easy to miss that a second click was even needed) and,
  // worse, meant the fast keyboard flow's own Enter-to-advance could carry
  // an accidental confirm past it. A modal, caught before submission, fixes
  // both: it appears right where the click happened, and Cancel is the
  // keyboard default (see the dialog's footer below), so a stray Enter from
  // that same fast-entry habit can't confirm anything by accident.
  const [showUnusualDialog, setShowUnusualDialog] = useState(false);
  // Sidesteps the interceptor on the ONE resubmission that follows an
  // explicit "Save anyway" click — see handleSaveAnyway.
  const bypassUnusualCheckRef = useRef(false);
  // Uncontrolled (not bound to React state) so handleSaveAnyway can set it
  // and call requestSubmit() in the same synchronous call, with no
  // dependency on a re-render landing before the browser reads the form.
  const confirmUnusualInputRef = useRef<HTMLInputElement>(null);

  const customerNameById = useMemo(
    () => new Map(payload.lines.map((line) => [line.customerId, line.customerName])),
    [payload.lines],
  );
  const productLabelById = useMemo(
    () => new Map(productColumns.map((product) => [product.productId, product.productShortName ?? product.productName])),
    [productColumns],
  );

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

  // Occasional-item rates never gate the save — a typed rate that differs
  // from the catalogue is the NORMAL case, not an anomaly, the whole point of
  // that feature. So they stay a soft visual cue only (amber highlight +
  // tooltip on the rate input, computed inline per-row). Confirmed by the
  // existing occasional-items test suite, which types a rate that differs
  // from the catalogue and expects the save to go straight through.

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
  // keystroke, which a fully controlled table of inputs would require. The
  // "looks unusual for this customer" highlight rides the same listener for
  // the same reason: it has to reflect what's currently TYPED, so it can only
  // be decided here, not baked into the cell's className at render time.
  const recompute = () => {
    const inputs = entryFormRef.current?.querySelectorAll<HTMLInputElement>("[data-daily-entry-quantity='true']");

    if (!inputs) {
      return;
    }

    let dirty = false;
    const perProduct = new Map<string, number>();
    let grandAmount = 0;
    const nextUnusualCells = new Map<string, UnusualCell>();

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

      const { unusual, text } = applyQuantityState(input);
      // Typing changes what the tooltip should say (a value can flip in or
      // out of "unusual" mid-keystroke), so keep it in sync for whichever
      // cell is actually focused right now.
      if (document.activeElement === input && activeCellTooltipRef.current) {
        showQuantityTooltip(activeCellTooltipRef.current, input, unusual, text);
      }

      if (unusual) {
        const customerId = input.dataset.customerId ?? "";
        nextUnusualCells.set(`${customerId}:${productId}`, {
          customerName: customerNameById.get(customerId) ?? "Customer",
          productLabel: productLabelById.get(productId) ?? "Product",
          quantity: current,
          detail: text,
        });
      }
    });

    setIsDirty(dirty);
    setTotals({ perProduct, grandAmount });
    setUnusualCells(nextUnusualCells);
  };

  // The "usually takes X" / "Unusual — ..." hint used to only surface on
  // mouse hover (the native `title` attribute) — easy to miss in a fast,
  // mostly-keyboard entry flow where a cell is tabbed into and typed in
  // without ever being hovered. This mirrors it into a small floating
  // tooltip that shows whenever a quantity cell is focused, keyboard or
  // mouse either way, and re-reads it live if the customer's route data
  // hasn't changed but the viewport has (scroll/resize).
  useEffect(() => {
    const form = entryFormRef.current;
    const tooltip = activeCellTooltipRef.current;

    if (!form || !tooltip) {
      return;
    }

    const showForInput = (input: HTMLInputElement) => {
      const { unusual, text } = applyQuantityState(input);
      showQuantityTooltip(tooltip, input, unusual, text);
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.dataset.dailyEntryQuantity === "true") {
        showForInput(target);
      }
    };

    const handleFocusOut = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.dataset.dailyEntryQuantity === "true") {
        tooltip.classList.add("hidden");
      }
    };

    const reposition = () => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && active.dataset.dailyEntryQuantity === "true") {
        showForInput(active);
      }
    };

    form.addEventListener("focusin", handleFocusIn);
    form.addEventListener("focusout", handleFocusOut);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);

    return () => {
      form.removeEventListener("focusin", handleFocusIn);
      form.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, []);

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

  // The actual bug: this used to be keyed on a stringified `state.message` +
  // `state.status`. Two separate blocked save attempts return the EXACT SAME
  // message text ("Some quantities on this route still look unusual..."), so
  // React saw no dependency change on the second attempt and never re-ran
  // this effect at all — meaning the restore-quantities logic below never
  // fired, while the browser's native form-reset (which isn't gated by this
  // effect) still ran, silently wiping the typed quantity to 0 on the SECOND
  // save click. Confirmed by testing the exact reported flow: Cancel, then
  // Save again — the cell read back 0, and what got saved on the next
  // confirm was nothing. Keying on the whole `state` object fixes it:
  // useActionState hands back a genuinely new object every dispatch, even
  // when its content is textually identical, so this now re-runs every time.
  const lastHandledStateRef = useRef<DailyEntryActionState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  // React resets every uncontrolled field in the form once its action
  // returns — success OR error (see the near-identical note in
  // doorstep-payment-dialog.tsx, which hit this for the same reason). That's
  // fine on success, but an error asking the operator to confirm and resubmit
  // — the whole point of the unusual-quantity gate below — would otherwise
  // wipe every quantity on the route right as they're being asked to look at
  // them. The grid can't switch to controlled inputs for this (uncontrolled
  // is deliberate, for performance on a large route), so instead: snapshot
  // every quantity right before the browser submits, and put it back if the
  // action comes back with an error.
  const pendingQuantitySnapshotRef = useRef<Map<string, string>>(new Map());

  const snapshotQuantitiesBeforeSubmit = () => {
    const inputs = entryFormRef.current?.querySelectorAll<HTMLInputElement>("[data-daily-entry-quantity='true']");
    const snapshot = new Map<string, string>();
    inputs?.forEach((input) => {
      snapshot.set(`${input.dataset.customerId ?? ""}:${input.dataset.productId ?? ""}`, input.value);
    });
    pendingQuantitySnapshotRef.current = snapshot;
  };

  // Catches an attempted save before it ever reaches the server: if anything
  // is still unusual, stop the submit and open the dialog instead. Both the
  // toolbar's Save button AND the fast-entry keyboard flow's Enter-at-the-
  // last-cell (below) go through this same native submit event, so neither
  // path can slip an unconfirmed unusual quantity through.
  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    snapshotQuantitiesBeforeSubmit();

    if (unusualCells.size > 0 && !bypassUnusualCheckRef.current) {
      event.preventDefault();
      setShowUnusualDialog(true);
      return;
    }

    bypassUnusualCheckRef.current = false;
  };

  // The dialog's own "Save anyway": sets the confirm flag directly on the
  // DOM (not through React state — see confirmUnusualInputRef's comment),
  // then resubmits. That resubmission runs through handleFormSubmit again,
  // where bypassUnusualCheckRef lets it through this time.
  const handleSaveAnyway = () => {
    bypassUnusualCheckRef.current = true;
    if (confirmUnusualInputRef.current) {
      confirmUnusualInputRef.current.value = "true";
    }
    setShowUnusualDialog(false);
    entryFormRef.current?.requestSubmit();
  };

  useEffect(() => {
    if (state.status === "idle" || !state.message) {
      return;
    }

    if (lastHandledStateRef.current === state) {
      return;
    }

    lastHandledStateRef.current = state;
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
    } else if (state.status === "error" && pendingQuantitySnapshotRef.current.size > 0) {
      // Put back what the browser just reset — see the ref's own comment.
      const inputs = entryFormRef.current?.querySelectorAll<HTMLInputElement>("[data-daily-entry-quantity='true']");
      inputs?.forEach((input) => {
        const snapshotValue = pendingQuantitySnapshotRef.current.get(
          `${input.dataset.customerId ?? ""}:${input.dataset.productId ?? ""}`,
        );
        if (snapshotValue !== undefined) {
          input.value = snapshotValue;
        }
      });
      recompute();
    }
    // recompute is intentionally not memoized (see its own comment) and not
    // listed here — this should only re-run when the save result changes,
    // not on every render. Depending on `state` as a whole (not its
    // destructured fields) is deliberate — see lastHandledStateRef's comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Same fix as lastHandledStateRef above, same reason: two revert attempts
  // can return identical text, and a stringified dedup key would silently
  // swallow the second toast.
  const lastHandledRevertStateRef = useRef<DailyEntryActionState | null>(null);
  useEffect(() => {
    if (revertState.status === "idle" || !revertState.message) {
      return;
    }

    if (lastHandledRevertStateRef.current === revertState) {
      return;
    }

    lastHandledRevertStateRef.current = revertState;
    setToast({
      tone: revertState.status === "success" ? "success" : "error",
      message: revertState.message,
    });
  }, [revertState]);

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
        onSubmit={handleFormSubmit}
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
        {/* Computed entirely client-side from data the page already has — no
            extra query. This is an advisory nudge, not an integrity check, so
            trusting what the browser reports is the right tradeoff: the worst
            a stale/bypassed value costs is a skipped confirmation prompt, not
            a wrong save. */}
        <input
          type="hidden"
          name="hasUnusualQuantities"
          value={unusualCells.size > 0 ? "true" : "false"}
          readOnly
        />
        {/* Uncontrolled — see confirmUnusualInputRef's own comment. Starts
            false on every fresh render (a route/date change, a reload, a
            successful save) so a stale confirmation never silently carries
            forward onto a different set of unusual cells. */}
        <input type="hidden" name="confirmUnusualQuantities" defaultValue="false" ref={confirmUnusualInputRef} />

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
                                data-customer-id={line.customerId}
                                data-rate={product?.defaultRate ?? "0"}
                                data-last-quantity={product?.lastQuantity ?? "0"}
                                // Band this customer's own recent deliveries of
                                // this product normally fall inside — absent
                                // when there isn't enough history yet. Read live
                                // by recompute() below, since whether a cell
                                // counts as unusual depends on what's currently
                                // TYPED, not on anything known at render time.
                                data-band-min={product?.unusualBandMin ?? ""}
                                data-band-max={product?.unusualBandMax ?? ""}
                                // This customer's own recent quantities of this
                                // product, and the single most common one — see
                                // applyQuantityState() above for how both feed
                                // into the unusual check and the tooltip text.
                                data-recent-quantities={product?.recentQuantities ?? ""}
                                data-mode-quantity={product?.modeQuantity ?? ""}
                                // The quantity is NOT prefilled — every cell
                                // starts at 0 and the highlight alone says
                                // "this is a product they normally take", so
                                // nobody saves last week's numbers by tabbing
                                // past. Hovering (or focusing — see the tooltip
                                // effect above) gives the actual figure, and
                                // "Fill usual" applies them deliberately.
                                title={
                                  Number(product?.modeQuantity ?? product?.lastQuantity ?? 0) > 0
                                    ? `Usually takes ${formatQty(Number(product?.modeQuantity ?? product?.lastQuantity ?? 0))}`
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
                        const rateOverridden =
                          product !== undefined &&
                          Number(row.rate || 0) > 0 &&
                          Math.abs(Number(row.rate) - Number(product.defaultRate)) > 0.001;

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
                                  title={
                                    rateOverridden
                                      ? `Catalogue rate is ₹${formatQty(Number(product?.defaultRate ?? 0))} — confirm this door price is correct`
                                      : undefined
                                  }
                                  className={cn(
                                    "h-9 w-24 rounded-md border px-2 text-sm text-text-primary outline-none focus:border-accent",
                                    rateOverridden
                                      ? "border-amber-500 bg-amber-50 ring-1 ring-amber-400"
                                      : "border-surface-border-strong bg-surface",
                                  )}
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

        {/* A backstop only — the dialog above catches this before the form
            ever submits, in the normal case. This still renders if the
            server ever disagrees with the client's own count (stale data,
            JS quirk), so the operator isn't left looking at nothing. */}
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

      {/* Caught before the form submits — see handleFormSubmit. Cancel is
          the autofocused default (and Escape/backdrop both do the same
          thing) so a stray Enter from the fast keyboard entry flow, or
          anyone just reflexively hitting Enter on a dialog, can't confirm
          something nobody actually looked at. */}
      <Dialog
        open={showUnusualDialog}
        title="Some quantities look unusual"
        description="These don't match what these customers usually take. Save anyway, or go back and check them."
        onClose={() => setShowUnusualDialog(false)}
        footer={
          <>
            <SecondaryButton autoFocus onClick={() => setShowUnusualDialog(false)}>
              Cancel
            </SecondaryButton>
            <PrimaryButton onClick={handleSaveAnyway}>Save anyway</PrimaryButton>
          </>
        }
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-text-primary">
          {[...unusualCells.values()].slice(0, 12).map((cell, index) => (
            <li key={index}>
              <span className="font-medium">{cell.customerName}</span> — {cell.productLabel}:{" "}
              {formatQty(cell.quantity)} ({cell.detail.replace("Unusual — ", "")})
            </li>
          ))}
        </ul>
        {unusualCells.size > 12 ? (
          <p className="mt-2 text-xs text-text-secondary">and {unusualCells.size - 12} more…</p>
        ) : null}
      </Dialog>

      {/* One shared floating tooltip, repositioned over whichever quantity
          cell is currently focused — see the focusin/focusout effect above. */}
      <div
        ref={activeCellTooltipRef}
        className="hidden fixed z-50 max-w-xs rounded-md border px-2.5 py-1.5 text-xs shadow-lg"
      />
    </div>
  );
}
