import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ToastTone = "success" | "warning" | "error" | "info";

export function Toast({
  tone = "info",
  children,
}: {
  tone?: ToastTone;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "fixed right-5 top-5 z-50 rounded-lg border bg-white px-4 py-3 text-sm font-medium shadow-lg",
        tone === "success" && "border-emerald-200 text-emerald-700",
        tone === "warning" && "border-amber-200 text-amber-700",
        tone === "error" && "border-rose-200 text-rose-700",
        tone === "info" && "border-blue-200 text-blue-700",
      )}
      role="status"
    >
      {children}
    </div>
  );
}
