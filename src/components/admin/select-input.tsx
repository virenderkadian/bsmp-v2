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
      {label ? <span className="text-xs font-medium text-slate-500">{label}</span> : null}
      <select
        className={cn(
          "h-10 rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-blue-600 focus:bg-white",
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
