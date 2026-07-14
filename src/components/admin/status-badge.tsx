import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        tone === "success" && "bg-status-success-bg text-status-success-text",
        tone === "warning" && "bg-status-warning-bg text-status-warning-text",
        tone === "danger" && "bg-status-danger-bg text-status-danger-text",
        tone === "info" && "bg-status-info-bg text-status-info-text",
        tone === "neutral" && "bg-surface-muted text-text-secondary",
      )}
    >
      {children}
    </span>
  );
}
