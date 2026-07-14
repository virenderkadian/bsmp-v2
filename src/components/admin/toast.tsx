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
        "fixed right-5 top-5 z-50 rounded-lg border bg-surface px-4 py-3 text-sm font-medium shadow-lg",
        tone === "success" && "border-status-success-text/30 text-status-success-text",
        tone === "warning" && "border-status-warning-text/30 text-status-warning-text",
        tone === "error" && "border-status-danger-text/30 text-status-danger-text",
        tone === "info" && "border-status-info-text/30 text-status-info-text",
      )}
      role="status"
    >
      {children}
    </div>
  );
}
