"use client";

import { useTheme } from "@/components/theme-provider";
import { THEMES } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function AppearancePanel() {
  const { theme, setTheme } = useTheme();

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">Appearance</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Choose a look for the app. Saved to this browser/device only, so it won&apos;t change other
          people&apos;s screens.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {THEMES.map((option) => {
          const selected = theme === option.id;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setTheme(option.id)}
              aria-pressed={selected}
              className={cn(
                "group flex flex-col overflow-hidden rounded-xl border-2 text-left transition",
                selected
                  ? "border-accent shadow-md"
                  : "border-surface-border hover:border-surface-border-strong hover:shadow-sm",
              )}
            >
              <span
                className="flex h-20 items-end gap-1.5 p-3"
                style={{ backgroundColor: option.swatch.bg }}
              >
                <span
                  className="h-8 w-8 rounded-md shadow-sm"
                  style={{ backgroundColor: option.swatch.surface, border: `1px solid ${option.swatch.accent}22` }}
                />
                <span className="h-5 w-5 rounded-full" style={{ backgroundColor: option.swatch.accent }} />
                <span className="ml-auto flex flex-col gap-1">
                  <span className="h-1.5 w-10 rounded-full" style={{ backgroundColor: option.swatch.text, opacity: 0.7 }} />
                  <span className="h-1.5 w-7 rounded-full" style={{ backgroundColor: option.swatch.text, opacity: 0.35 }} />
                </span>
              </span>
              <span className="flex items-start justify-between gap-2 bg-surface p-3">
                <span>
                  <span className="block text-sm font-semibold text-text-primary">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-text-secondary">{option.description}</span>
                </span>
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition",
                    selected ? "border-accent bg-accent" : "border-surface-border-strong bg-surface",
                  )}
                  aria-hidden="true"
                >
                  {selected ? (
                    <svg viewBox="0 0 16 16" className="h-3 w-3 text-accent-contrast" fill="none">
                      <path
                        d="M3.5 8.5L6.5 11.5L12.5 4.5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
