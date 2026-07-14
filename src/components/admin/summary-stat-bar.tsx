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
        "flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-surface-border bg-surface px-4 py-2.5 shadow-sm",
        className,
      )}
    >
      {stats.map((stat, index) => (
        <Fragment key={stat.key}>
          {index > 0 ? (
            <span className="hidden h-4 w-px bg-surface-border sm:block" aria-hidden="true" />
          ) : null}
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
              {stat.label}
            </span>
            <span
              className={cn(
                "text-sm font-bold tabular-nums",
                stat.tone === "success"
                  ? "text-status-success-text"
                  : stat.tone === "danger"
                    ? "text-status-danger-text"
                    : "text-text-primary",
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
