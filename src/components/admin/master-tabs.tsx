import { cn } from "@/lib/utils";

export type MasterTabItem<TValue extends string> = {
  value: TValue;
  label: string;
  count?: number;
};

export function MasterTabs<TValue extends string>({
  tabs,
  activeValue,
  onChange,
  className,
}: {
  tabs: Array<MasterTabItem<TValue>>;
  activeValue: TValue;
  onChange: (value: TValue) => void;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex items-center gap-1 rounded-lg border border-surface-border bg-surface-muted p-1", className)}>
      {tabs.map((tab) => {
        const isActive = activeValue === tab.value;

        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-md px-3.5 text-sm font-medium transition",
              isActive ? "bg-surface text-accent-soft-text shadow-sm" : "text-text-secondary hover:text-text-primary",
            )}
          >
            {tab.label}
            {typeof tab.count === "number" ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none",
                  isActive ? "bg-accent-soft text-accent-soft-text" : "bg-surface-border text-text-secondary",
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
