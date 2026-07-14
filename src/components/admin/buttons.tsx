import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
};

const baseStyles =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:border-surface-border disabled:bg-surface-muted disabled:text-text-muted";

export function PrimaryButton({ className, icon, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        baseStyles,
        "border-accent bg-accent text-accent-contrast hover:bg-accent-hover",
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
        "border-surface-border-strong bg-surface text-text-secondary hover:bg-surface-muted",
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
        "inline-flex h-8 items-center justify-center gap-1 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
