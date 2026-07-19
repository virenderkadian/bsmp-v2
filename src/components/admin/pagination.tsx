"use client";

import { cn } from "@/lib/utils";

// Compact pager for client-paginated tables. Renders nothing when there's
// only a single page so short lists stay clean. Shows "Showing X–Y of Z"
// plus prev/next and a small window of page numbers.
export function Pagination({
  page,
  totalPages,
  total,
  startIndex,
  endIndex,
  onPageChange,
  itemLabel = "records",
  className,
}: {
  page: number;
  totalPages: number;
  total: number;
  startIndex: number;
  endIndex: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  className?: string;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const pages = pageWindow(page, totalPages);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-between gap-3 border-t border-surface-border px-1 pt-3 sm:flex-row",
        className,
      )}
    >
      <p className="text-sm text-text-secondary">
        Showing <span className="font-semibold text-text-primary tabular-nums">{startIndex}</span>–
        <span className="font-semibold text-text-primary tabular-nums">{endIndex}</span> of{" "}
        <span className="font-semibold text-text-primary tabular-nums">{total}</span> {itemLabel}
      </p>
      <div className="flex items-center gap-1">
        <PagerButton onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          Prev
        </PagerButton>
        {pages.map((entry, index) =>
          entry === "…" ? (
            <span key={`gap-${index}`} className="px-2 text-sm text-text-muted">
              …
            </span>
          ) : (
            <PagerButton
              key={entry}
              onClick={() => onPageChange(entry)}
              active={entry === page}
            >
              {entry}
            </PagerButton>
          ),
        )}
        <PagerButton onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
          Next
        </PagerButton>
      </div>
    </div>
  );
}

function PagerButton({
  children,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-9 min-w-9 items-center justify-center rounded-md border px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "border-accent bg-accent text-accent-contrast"
          : "border-surface-border-strong bg-surface text-text-secondary hover:bg-surface-muted hover:text-text-primary",
      )}
    >
      {children}
    </button>
  );
}

// A compact page list: first, last, current ±1, with … gaps.
function pageWindow(page: number, totalPages: number): Array<number | "…"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages: Array<number | "…"> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  if (start > 2) {
    pages.push("…");
  }
  for (let current = start; current <= end; current += 1) {
    pages.push(current);
  }
  if (end < totalPages - 1) {
    pages.push("…");
  }
  pages.push(totalPages);

  return pages;
}
