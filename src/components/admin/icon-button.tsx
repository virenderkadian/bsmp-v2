import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function IconButton({
  tone = "neutral",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "neutral" | "danger";
  children: ReactNode;
}) {
  return (
    <button
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-40",
        tone === "neutral" && "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
        tone === "danger" && "text-rose-600 hover:bg-rose-50 hover:text-rose-700",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
