"use client";

import { useActionState, useEffect, useState } from "react";
import { BillFormatThumbnail } from "@/app/settings/bill-format-thumbnail";
import { updateCitySetting, type ActionState } from "@/app/settings/configuration-actions";
import { Toast, type ToastTone } from "@/components/admin/toast";
import {
  CITY_SETTING_FIELDS,
  CITY_SETTING_KEYS,
  SETTING_GROUP_ORDER,
  type CitySettings,
} from "@/lib/city-settings.shared";
import { cn } from "@/lib/utils";

const initialState: ActionState = { status: "idle" };

// How this city behaves.
//
// Grouped by where the change shows up, and each setting saves itself — no Save
// button, so there is no half-applied state and nothing is lost by navigating
// away mid-change.
export function ConfigurationPanel({ settings }: { settings: CitySettings }) {
  const [state, formAction, pending] = useActionState(updateCitySetting, initialState);
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);
  const [handled, setHandled] = useState<string | null>(null);

  const resultKey =
    state.status !== "idle" && state.message
      ? `${state.status}:${state.message}:${state.token ?? ""}`
      : null;

  if (resultKey && state.message && resultKey !== handled) {
    setHandled(resultKey);
    setToast({ tone: state.status === "success" ? "success" : "error", message: state.message });
  }

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const groups = SETTING_GROUP_ORDER.map((heading) => ({
    heading,
    keys: CITY_SETTING_KEYS.filter((key) => CITY_SETTING_FIELDS[key].group === heading),
  })).filter((group) => group.keys.length > 0);

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-text-secondary">
        Applies to the city you are working in. Every change saves on its own.
      </p>

      {groups.map((group) => (
        <section key={group.heading} className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
            {group.heading}
          </h3>

          <div className="divide-y divide-surface-border overflow-hidden rounded-xl border border-surface-border bg-surface shadow-sm">
            {group.keys.map((key) => {
              const field = CITY_SETTING_FIELDS[key];

              if (field.kind === "boolean") {
                const checked = settings[key] === true;

                return (
                  <form key={key} action={formAction} className="flex items-center gap-4 px-4 py-3">
                    <input type="hidden" name="key" value={key} readOnly />
                    {/* The value being moved TO — the switch submits the
                        opposite of what is showing, so the server never has to
                        guess. */}
                    <input type="hidden" name="value" value={checked ? "false" : "true"} readOnly />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary">{field.label}</p>
                      <p className="text-xs text-text-secondary">{field.description}</p>
                    </div>
                    <button
                      type="submit"
                      role="switch"
                      aria-checked={checked}
                      aria-label={field.label}
                      disabled={pending}
                      className={cn(
                        "inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition disabled:opacity-50",
                        checked
                          ? "justify-end border-accent bg-accent"
                          : "justify-start border-surface-border-strong bg-surface-muted",
                      )}
                    >
                      <span className="mx-0.5 h-5 w-5 rounded-full bg-surface shadow-sm" />
                    </button>
                  </form>
                );
              }

              const current = String(settings[key]);

              return (
                <div key={key} className="px-4 py-3">
                  <p className="text-sm font-medium text-text-primary">{field.label}</p>
                  <p className="text-xs text-text-secondary">{field.description}</p>

                  {/* The drawing is the explanation. The shape of the page is
                      what the choice actually changes. */}
                  <div className="mt-3 flex flex-wrap gap-3">
                    {field.options.map((option) => {
                      const active = current === option.value;

                      return (
                        <form key={option.value} action={formAction}>
                          <input type="hidden" name="key" value={key} readOnly />
                          <input type="hidden" name="value" value={option.value} readOnly />
                          <button
                            type="submit"
                            disabled={pending || active}
                            aria-pressed={active}
                            className={cn(
                              "flex w-[244px] gap-3 rounded-lg border p-2.5 text-left transition",
                              active
                                ? "border-accent bg-accent-soft"
                                : "border-surface-border bg-surface hover:border-surface-border-strong hover:bg-surface-muted",
                              pending && !active && "opacity-60",
                            )}
                          >
                            <BillFormatThumbnail format={option.value} />
                            <span className="flex min-w-0 flex-col">
                              <span className="flex items-center gap-1.5">
                                <span className="text-sm font-semibold text-text-primary">
                                  {option.label}
                                </span>
                                {active ? (
                                  <span className="whitespace-nowrap rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-contrast">
                                    In use
                                  </span>
                                ) : null}
                              </span>
                              <span className="mt-0.5 text-xs leading-snug text-text-secondary">
                                {option.description}
                              </span>
                            </span>
                          </button>
                        </form>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {toast ? <Toast tone={toast.tone}>{toast.message}</Toast> : null}
    </div>
  );
}
