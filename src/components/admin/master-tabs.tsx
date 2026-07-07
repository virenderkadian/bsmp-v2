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
    <div className={cn("inline-flex rounded-md border border-slate-200 bg-[#0F172A] p-1 shadow-sm", className)}>
      {tabs.map((tab) => {
        const isActive = activeValue === tab.value;

        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded px-4 text-sm font-semibold transition flex-1 justify-center",
              isActive ? "bg-[#2a446e] text-blue-400" : "text-slate-300 hover:bg-[#2a446e]/80 hover:text-white",
            )}
          >
            {tab.label}
            {typeof tab.count === "number" ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs",
                  isActive ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500",
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
