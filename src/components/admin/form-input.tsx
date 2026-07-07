import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type FormInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
};

export function FormInput({ label, className, ...props }: FormInputProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        className={cn(
          "h-10 rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:bg-white",
          className,
        )}
        {...props}
      />
    </label>
  );
}
