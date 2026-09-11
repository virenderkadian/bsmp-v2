"use client";

import { useActionState, useEffect, useState } from "react";
import { updateCitySetting, type ActionState } from "@/app/settings/configuration-actions";
import { Toast, type ToastTone } from "@/components/admin/toast";
import {
  CITY_SETTING_LABELS,
  type CitySettingKey,
  type CitySettings,
} from "@/lib/city-settings.shared";

const initialState: ActionState = { status: "idle" };

// How this city behaves, as a list of switches.
//
// Deliberately not a form with a Save button: each switch is one decision and
// saves itself, so there is no half-applied state and nothing to lose by
// navigating away mid-change.
export function ConfigurationPanel({ settings }: { settings: CitySettings }) {
  const [state, formAction, pending] = useActionState(updateCitySetting, initialState);
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);
  const [handled, setHandled] = useState<string | null>(null);

  const resultKey = state.status !== "idle" && state.message ? `${state.status}:${state.message}:${state.token ?? ""}` : null;

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

  const keys = Object.keys(CITY_SETTING_LABELS) as CitySettingKey[];

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-text-secondary">
        These apply to the city you are currently working in. Each change saves on its own.
      </p>

      <div className="divide-y divide-surface-border overflow-hidden rounded-xl border border-surface-border bg-surface shadow-sm">
        {keys.map((key) => {
          const copy = CITY_SETTING_LABELS[key];
          const checked = settings[key];

          return (
            <form key={key} action={formAction} className="flex items-start gap-4 px-4 py-4">
              <input type="hidden" name="key" value={key} readOnly />
              {/* The value being moved TO — the switch submits the opposite of
                  what is showing, so the server never has to guess. */}
              <input type="hidden" name="value" value={checked ? "false" : "true"} readOnly />
              <button
                type="submit"
                role="switch"
                aria-checked={checked}
                aria-label={copy.label}
                disabled={pending}
                className={`mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition disabled:opacity-50 ${
                  checked ? "justify-end border-accent bg-accent" : "justify-start border-surface-border-strong bg-surface-muted"
                }`}
              >
                <span className="mx-0.5 h-5 w-5 rounded-full bg-surface shadow-sm" />
              </button>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary">{copy.label}</p>
                <p className="mt-0.5 text-sm text-text-secondary">{copy.description}</p>
              </div>
            </form>
          );
        })}
      </div>

      {toast ? <Toast tone={toast.tone}>{toast.message}</Toast> : null}
    </div>
  );
}
