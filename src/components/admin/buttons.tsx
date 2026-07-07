import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
};

const baseStyles =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400";

export function PrimaryButton({ className, icon, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        baseStyles,
        "border-blue-600 bg-blue-600 text-white hover:bg-blue-700",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

export function SecondaryButton({ className, icon, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        baseStyles,
        "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

export function ActionButton({ className, icon, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
