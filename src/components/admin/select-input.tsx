import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type SelectInputProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
};

export function SelectInput({ label, options, placeholder, className, ...props }: SelectInputProps) {
  return (
    <label className="flex flex-col gap-1.5">
      {label ? <span className="text-xs font-medium text-text-secondary">{label}</span> : null}
      <select
        className={cn(
          "h-10 rounded-lg border border-surface-border-strong bg-surface-muted px-3 text-sm text-text-primary outline-none transition focus:border-accent focus:bg-surface",
          className,
        )}
        {...props}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
