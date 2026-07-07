import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function FilterBar({
  children,
  actions,
  className,
  gridClassName,
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  gridClassName?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-slate-200 bg-white p-4 shadow-sm", className)}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div
          className={cn("grid flex-1 gap-4 md:grid-cols-2 xl:grid-cols-4", gridClassName)}
        >
          {children}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </section>
  );
}
