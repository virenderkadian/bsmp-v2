import type { ReactNode } from "react";

export function StickyActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-surface-border bg-surface/95 px-6 py-3 shadow-[0_-8px_20px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-end gap-3">
        {children}
      </div>
    </div>
  );
}
