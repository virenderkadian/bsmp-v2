import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatusChip({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "info";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold",
        tone === "success" && "bg-status-success-bg text-status-success-text",
        tone === "warning" && "bg-status-warning-bg text-status-warning-text",
        tone === "info" && "bg-status-info-bg text-status-info-text",
        tone === "neutral" && "bg-surface-muted text-text-secondary",
      )}
    >
      {children}
    </span>
  );
}
