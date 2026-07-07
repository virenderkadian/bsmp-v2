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

export function PageLoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3 text-sm font-medium text-slate-500">
        <LoadingSpinner className="h-5 w-5 text-blue-600" />
        <span>{label}</span>
      </div>
      <div className="space-y-4">
        <div className="h-10 w-72 animate-pulse rounded-md bg-slate-200" />
        <div className="rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="h-12 border-b border-slate-200 bg-slate-100/70" />
          <div className="space-y-0 divide-y divide-slate-200">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="grid grid-cols-4 gap-6 px-5 py-4">
                <div className="h-4 animate-pulse rounded bg-slate-200" />
                <div className="h-4 animate-pulse rounded bg-slate-200" />
                <div className="h-4 animate-pulse rounded bg-slate-200" />
                <div className="h-4 animate-pulse rounded bg-slate-200" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
