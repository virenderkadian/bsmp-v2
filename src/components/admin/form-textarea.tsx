import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type FormTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
};

export function FormTextarea({ label, className, rows = 3, ...props }: FormTextareaProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <textarea
        rows={rows}
        className={cn(
          "rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:bg-white",
          className,
        )}
        {...props}
      />
    </label>
  );
}
