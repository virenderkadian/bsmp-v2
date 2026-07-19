import { useMemo, useState } from "react";

export type PaginationResult<T> = {
  pageItems: T[];
  page: number;
  setPage: (page: number) => void;
  totalPages: number;
  total: number;
  pageSize: number;
  // 1-based index of the first/last item on the current page (for
  // "Showing X–Y of Z" labels). Both 0 when there are no items.
  startIndex: number;
  endIndex: number;
};

// Client-side pagination over an already-filtered list, so search/filters
// always run against the whole dataset and pagination only slices the
// result. `resetKey` should be the current filter values (stringified) —
// changing it snaps back to page 1 so a filter change never leaves you
// stranded on a now-empty page.
export function usePagination<T>(
  items: T[],
  { pageSize = 50, resetKey = "" }: { pageSize?: number; resetKey?: string } = {},
): PaginationResult<T> {
  const [page, setPage] = useState(1);

  // Reset to page 1 when the filters change, using React's "adjust state
  // during render" pattern (tracking the previous key) rather than an
  // effect — no extra render pass, and correct on the very first paint
  // after a filter change.
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setPage(1);
  }

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Derive the effective page instead of storing a clamped value — keeps the
  // page valid after deletions with no effect/setState needed.
  const safePage = Math.min(page, totalPages);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  const startIndex = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endIndex = Math.min(safePage * pageSize, total);

  return {
    pageItems,
    page: safePage,
    setPage,
    totalPages,
    total,
    pageSize,
    startIndex,
    endIndex,
  };
}
