import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type PillToggleProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active: boolean;
  activeLabel?: string;
  inactiveLabel?: string;
  pending?: boolean;
};

export function PillToggle({
  active,
  activeLabel = "Active",
  inactiveLabel = "Inactive",
  pending = false,
  className,
  disabled,
  ...props
}: PillToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      disabled={disabled || pending}
      className={cn(
        "inline-flex h-8 min-w-[104px] rounded-full items-center p-0.5 pr-3 text-xs font-semibold transition",
        "disabled:cursor-not-allowed disabled:opacity-60",
        active
          ? " text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100"
          : " text-slate-600 hover:border-slate-400 hover:bg-slate-200",
        className,
      )}
      {...props}
    >
      <span
        className={cn("relative h-6 w-11 rounded-full transition", active ? "bg-emerald-500" : "bg-slate-400")}
        aria-hidden="true"
      >
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            active ? "translate-x-5" : "translate-x-0",
          )}
        />
      </span>
      <span className="ml-2 min-w-[46px] text-left">
        {pending ? "Saving..." : active ? activeLabel : inactiveLabel}
      </span>
    </button>
  );
}
