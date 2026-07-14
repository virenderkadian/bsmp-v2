import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type FormTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
};

export function FormTextarea({ label, className, rows = 3, ...props }: FormTextareaProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <textarea
        rows={rows}
        className={cn(
          "rounded-lg border border-surface-border-strong bg-surface-muted px-3 py-2 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-accent focus:bg-surface",
          className,
        )}
        {...props}
      />
    </label>
  );
}
