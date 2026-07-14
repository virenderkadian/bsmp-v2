"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { SecondaryButton } from "@/components/admin/buttons";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  title,
  description,
  children,
  onClose,
  footer,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode | null;
}) {
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

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-slate-950/50"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative z-10 flex max-h-[calc(100vh-4rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-2xl",
        )}
      >
        <header className="border-b border-surface-border px-6 py-5">
          <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-text-secondary">{description}</p>
          ) : null}
        </header>

        <div className="overflow-y-auto px-6 py-5">{children}</div>

        {footer === null ? null : (
          <footer className="flex items-center justify-end gap-3 border-t border-surface-border px-6 py-4">
            {footer ?? <SecondaryButton onClick={onClose}>Close</SecondaryButton>}
          </footer>
        )}
      </section>
    </div>
  );
}
