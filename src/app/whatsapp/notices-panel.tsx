"use client";

import { useMemo, useState, useTransition } from "react";
import { previewNoticeAudienceAction, queueNoticeAction, type PickerState } from "@/app/whatsapp/actions";
import { RecipientPicker } from "@/app/whatsapp/recipient-picker";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { FormInput } from "@/components/admin/form-input";
import { SelectInput } from "@/components/admin/select-input";
import type { NoticeProduct } from "@/lib/notifications/notices";
import {
  buildRatesText, deliveryNoticeValues, MAX_NOTICE_TEXT, rateChangeValues, toSingleLine, ZOEPACT_TEMPLATES,
  zoepactVariableSchemas,
} from "@/lib/notifications/zoepact-templates";

type NoticeKind = "rate_change_notice_v1" | "delivery_notice_v1";

type RateRow = { key: number; productId: string; name: string; unit: string; oldRate: string; newRate: string };

const OTHER = "__other";

// "2026-12-01" -> "1 December 2026", the way the customer reads it.
function readableDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

// The template with its slots filled, as the customer will read it.
function fill(body: string, values: string[]): string {
  return values.reduce((text, value, index) => text.replace(`{{${index + 1}}}`, value || `[${index + 1}]`), body);
}

// Rate change and delivery notices. Both are approved templates, so the wording around
// the blanks is fixed and the office fills the blanks. The rate change takes any number
// of products: they are joined into one line, because a WhatsApp template value can't
// contain a line break.
export function NoticesPanel({ canSend, products }: { canSend: boolean; products: NoticeProduct[] }) {
  const [kind, setKind] = useState<NoticeKind>("rate_change_notice_v1");

  // Rate change
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [rows, setRows] = useState<RateRow[]>([{ key: 1, productId: "", name: "", unit: "", oldRate: "", newRate: "" }]);
  // Delivery notice
  const [noticeDate, setNoticeDate] = useState("");
  const [messageHi, setMessageHi] = useState("");
  const [messageEn, setMessageEn] = useState("");

  const [state, setState] = useState<PickerState>({ status: "idle" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const template = ZOEPACT_TEMPLATES[kind];

  const variables = useMemo(() => {
    if (kind === "rate_change_notice_v1") {
      const complete = rows.filter((row) => row.name.trim() && row.oldRate !== "" && row.newRate !== "");
      return {
        effectiveDate: readableDate(effectiveFrom),
        ratesText: buildRatesText(complete.map((row) => ({ name: row.name, unit: row.unit, oldRate: Number(row.oldRate), newRate: Number(row.newRate) }))),
      };
    }
    return { date: readableDate(noticeDate), messageHi: toSingleLine(messageHi), messageEn: toSingleLine(messageEn) };
  }, [kind, effectiveFrom, rows, noticeDate, messageHi, messageEn]);

  const check = zoepactVariableSchemas[kind].safeParse(variables);
  const problem = check.success ? null : check.error.issues[0]?.message ?? "Fill in every field";
  const values =
    kind === "rate_change_notice_v1"
      ? rateChangeValues(variables as { effectiveDate: string; ratesText: string })
      : deliveryNoticeValues(variables as { date: string; messageHi: string; messageEn: string });
  const ratesLength = kind === "rate_change_notice_v1" ? (variables as { ratesText: string }).ratesText.length : 0;

  const setRow = (key: number, patch: Partial<RateRow>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const pickProduct = (key: number, productId: string) => {
    const product = products.find((entry) => entry.id === productId);
    setRow(key, product
      ? { productId, name: product.name, unit: product.unit, oldRate: String(Number(product.defaultRate)) }
      : { productId, name: "", unit: "", oldRate: "" });
  };

  const addRow = () => setRows((current) => [...current, { key: Math.max(0, ...current.map((row) => row.key)) + 1, productId: "", name: "", unit: "", oldRate: "", newRate: "" }]);
  const removeRow = (key: number) => setRows((current) => (current.length > 1 ? current.filter((row) => row.key !== key) : current));

  const changeKind = (next: NoticeKind) => {
    setKind(next);
    // A list chosen for one notice must not be queued under another.
    setState({ status: "idle" });
    setSelected(new Set());
  };

  const chooseWho = () =>
    startTransition(async () => {
      const next = await previewNoticeAudienceAction();
      setState(next);
      setSelected(new Set(next.status === "ready" ? next.rows.map((row) => row.id) : []));
    });

  const queue = () =>
    startTransition(async () => {
      const next = await queueNoticeAction(kind, variables, [...selected]);
      setState(next);
      if (next.status === "queued") setSelected(new Set());
    });

  const ready = state.status === "ready" ? state : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4 rounded-lg border border-surface-border bg-surface p-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Send a notice</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Fill in the blanks, choose who gets it, then queue. The matching template must show Approved on the Templates tab
              before anything can be sent. Messages go out between 9am and 8pm.
            </p>
          </div>

          <SelectInput
            label="Notice type"
            value={kind}
            onChange={(event) => changeKind(event.target.value as NoticeKind)}
            options={[
              { value: "rate_change_notice_v1", label: ZOEPACT_TEMPLATES.rate_change_notice_v1.label },
              { value: "delivery_notice_v1", label: ZOEPACT_TEMPLATES.delivery_notice_v1.label },
            ]}
          />

          {kind === "rate_change_notice_v1" ? (
            <div className="space-y-4">
              <FormInput label="New rates apply from" type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />

              <div className="space-y-3">
                {rows.map((row, index) => (
                  <div key={row.key} className="space-y-2 rounded-lg border border-surface-border p-3">
                    <div className="flex items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <SelectInput
                          label={`Product ${index + 1}`}
                          value={row.productId}
                          onChange={(event) => pickProduct(row.key, event.target.value)}
                          placeholder="Choose a product"
                          options={[...products.map((product) => ({ value: product.id, label: product.name })), { value: OTHER, label: "Other (type a name)" }]}
                        />
                      </div>
                      {rows.length > 1 ? (
                        <SecondaryButton type="button" onClick={() => removeRow(row.key)}>
                          Remove
                        </SecondaryButton>
                      ) : null}
                    </div>
                    {row.productId === OTHER ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <FormInput label="Product name" value={row.name} onChange={(event) => setRow(row.key, { name: event.target.value })} />
                        <FormInput label="Unit (litre, kg)" value={row.unit} onChange={(event) => setRow(row.key, { unit: event.target.value })} />
                      </div>
                    ) : null}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <FormInput label="Old rate (₹)" type="number" min={0} step="0.01" inputMode="decimal" value={row.oldRate} onChange={(event) => setRow(row.key, { oldRate: event.target.value })} />
                      <FormInput label="New rate (₹)" type="number" min={0} step="0.01" inputMode="decimal" value={row.newRate} onChange={(event) => setRow(row.key, { newRate: event.target.value })} />
                    </div>
                  </div>
                ))}
              </div>

              <SecondaryButton type="button" onClick={addRow}>
                Add another product
              </SecondaryButton>
              <p className="text-xs text-text-secondary">
                The products go out on one line ({ratesLength} of {MAX_NOTICE_TEXT} characters used).
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <FormInput label="Date" type="date" value={noticeDate} onChange={(event) => setNoticeDate(event.target.value)} />
              <FormInput label="Message in Hindi" value={messageHi} onChange={(event) => setMessageHi(event.target.value)} placeholder="आज दूध की डिलीवरी बंद रहेगी" />
              <FormInput label="Message in English" value={messageEn} onChange={(event) => setMessageEn(event.target.value)} placeholder="There will be no milk delivery today" />
              <p className="text-xs text-text-secondary">Keep each message to one line. Line breaks are removed.</p>
            </div>
          )}

          {problem ? <p className="text-sm text-text-muted">To continue: complete every field.</p> : null}

          <div className="flex flex-wrap gap-2">
            <SecondaryButton type="button" onClick={chooseWho} disabled={!canSend || pending || problem !== null}>
              {pending ? "Working…" : ready ? "Reload the list" : "Choose who gets it"}
            </SecondaryButton>
            {ready && ready.rows.length > 0 ? (
              <PrimaryButton type="button" onClick={queue} disabled={!canSend || pending || problem !== null || selected.size === 0}>
                Queue {selected.size} notice{selected.size === 1 ? "" : "s"}
              </PrimaryButton>
            ) : null}
          </div>
          {!canSend ? <p className="text-sm text-text-secondary">Only an admin can queue customer messages.</p> : null}
          {state.status === "error" ? <p className="text-sm text-status-danger-text">{state.message}</p> : null}
          {state.status === "queued" ? <p className="text-sm text-status-success-text">{state.message}</p> : null}
          {ready ? <p className="text-sm text-text-primary">{ready.message}</p> : null}
        </div>

        <div className="rounded-lg border border-surface-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text-primary">What the customer receives</h2>
          <div className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-muted p-3 text-sm leading-relaxed text-text-primary">
            {fill(template.body, values)}
            {"\n\n"}
            {template.footer}
          </div>
          <p className="mt-2 text-xs text-text-secondary">Category: {template.category}. Meta decides the final category when it reviews the template.</p>
        </div>
      </div>

      {ready && ready.rows.length > 0 ? (
        <div className="rounded-lg border border-surface-border bg-surface p-4">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Who gets this notice</h3>
          <RecipientPicker rows={ready.rows} selected={selected} onChange={setSelected} disabled={pending || !canSend} />
        </div>
      ) : null}
    </div>
  );
}
