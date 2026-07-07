import { Fragment } from "react";
import { cn } from "@/lib/utils";

export type SummaryStatItem = {
  key: string;
  label: string;
  value: string;
  tone?: "default" | "success" | "danger";
};

export function SummaryStatBar({
  stats,
  className,
}: {
  stats: SummaryStatItem[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-sm",
        className,
      )}
    >
      {stats.map((stat, index) => (
        <Fragment key={stat.key}>
          {index > 0 ? (
            <span className="hidden h-4 w-px bg-slate-200 sm:block" aria-hidden="true" />
          ) : null}
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              {stat.label}
            </span>
            <span
              className={cn(
                "text-sm font-bold tabular-nums",
                stat.tone === "success"
                  ? "text-emerald-700"
                  : stat.tone === "danger"
                    ? "text-rose-700"
                    : "text-slate-900",
              )}
            >
              {stat.value}
            </span>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
