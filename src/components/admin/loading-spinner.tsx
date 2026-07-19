import { cn } from "@/lib/utils";

export function LoadingSpinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent",
        className,
      )}
    />
  );
}

export function PageLoadingState({
  label = "Loading",
  rows = 8,
  columns = 4,
}: {
  label?: string;
  rows?: number;
  columns?: number;
}) {
  return (
    <section className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
        <LoadingSpinner className="h-4 w-4 text-accent" />
        <span>{label}</span>
      </div>
      {/* Filter-bar placeholder */}
      <div className="flex flex-wrap gap-3">
        <div className="h-10 w-64 animate-pulse rounded-md bg-surface-muted" />
        <div className="h-10 w-40 animate-pulse rounded-md bg-surface-muted" />
        <div className="ml-auto h-10 w-32 animate-pulse rounded-md bg-surface-muted" />
      </div>
      {/* Table placeholder */}
      <div className="overflow-hidden rounded-md border border-surface-border bg-surface shadow-sm">
        <div className="h-12 border-b border-surface-border bg-surface-muted" />
        <div className="divide-y divide-surface-border">
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <div
              key={rowIndex}
              className="grid gap-6 px-5 py-4"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: columns }).map((_, colIndex) => (
                <div
                  key={colIndex}
                  className="h-4 animate-pulse rounded bg-surface-muted"
                  style={{ width: colIndex === 0 ? "75%" : "55%" }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
