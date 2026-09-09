"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { SecondaryButton } from "@/components/admin/buttons";
import { FilterIcon, XIcon } from "@/components/admin/icons";
import { cn } from "@/lib/utils";

// Matches the transition duration below — the panel stays mounted this long
// after closing so the animation can finish.
const CLOSE_MS = 200;

// A side panel for filters, opened from a single button.
//
// Screens like Monthly Bills had grown a toolbar of seven controls competing
// with the tabs and the page actions for one row. Collapsing them behind one
// button is only safe if the screen still SAYS it is filtered — a hidden
// filter that silently removes rows is worse than a crowded toolbar. So the
// button carries a count, and the caller shows a chip per active filter.

export function FilterButton({
  activeCount,
  onClick,
}: {
  activeCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={activeCount > 0 ? `Filters, ${activeCount} active` : "Filters"}
      className={cn(
        "inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-3.5 text-sm font-semibold transition",
        activeCount > 0
          ? "border-accent bg-accent-soft text-accent"
          : "border-surface-border-strong bg-surface text-text-secondary hover:bg-surface-muted",
      )}
    >
      <FilterIcon className="h-4 w-4" />
      Filters
      {activeCount > 0 ? (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold text-white tabular-nums">
          {activeCount}
        </span>
      ) : null}
    </button>
  );
}

// One active filter, shown in the toolbar so the screen never hides the fact
// that it is showing a subset. Clicking the chip clears that one filter.
export function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label={`Clear filter: ${label}`}
      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-surface-border-strong bg-surface px-2.5 text-xs font-medium text-text-secondary transition hover:bg-surface-muted"
    >
      {label}
      <XIcon className="h-3.5 w-3.5" />
    </button>
  );
}

export function FilterPanel({
  open,
  onClose,
  onClear,
  activeCount,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onClear: () => void;
  activeCount: number;
  children: ReactNode;
}) {
  // The panel has to outlive `open` by one transition, or closing would snap
  // the backdrop off as abruptly as it used to snap on.
  //
  // `closing` is adjusted during render rather than in an effect: React
  // supports comparing props to previous state this way, and it avoids a
  // second paint where the panel is mounted but has not been told to animate.
  const [closing, setClosing] = useState(false);
  const [shown, setShown] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);

  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setClosing(false);
    } else {
      setClosing(true);
      setShown(false);
    }
  }

  const mounted = open || closing;

  // A frame after mounting, so the browser has a start state to move from.
  // Setting it synchronously would put the panel straight into its final
  // position with nothing to transition.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (open) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setClosing(false), CLOSE_MS);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!mounted) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close filters"
        className={cn(
          "absolute inset-0 bg-slate-950/40 transition-opacity duration-200 ease-out motion-reduce:transition-none",
          shown ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        className={cn(
          "relative flex h-full w-full max-w-sm flex-col border-l border-surface-border bg-surface shadow-2xl",
          "transition-transform duration-200 ease-out motion-reduce:transition-none",
          shown ? "translate-x-0" : "translate-x-full",
        )}
      >
        <header className="flex items-center justify-between border-b border-surface-border px-5 py-4">
          <h2 className="text-base font-semibold text-text-primary">Filters</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">{children}</div>

        <footer className="flex items-center justify-between gap-3 border-t border-surface-border px-5 py-4">
          <SecondaryButton
            type="button"
            onClick={onClear}
            disabled={activeCount === 0}
            className="h-10 px-4 text-sm font-medium"
          >
            Clear all
          </SecondaryButton>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}
