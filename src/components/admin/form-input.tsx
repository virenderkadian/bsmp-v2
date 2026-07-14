import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type FormInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
};

export function FormInput({ label, className, ...props }: FormInputProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <input
        className={cn(
          "h-10 rounded-lg border border-surface-border-strong bg-surface-muted px-3 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-accent focus:bg-surface",
          className,
        )}
        {...props}
      />
    </label>
  );
}
