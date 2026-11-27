import { cn } from "@/lib/utils";

export type SummaryCardProps = {
  label: string;
  value: string | number;
  note: string;
  tone?: "default" | "success" | "warning" | "danger";
  // Only a client component can pass this; a card without it is a plain, non-clickable tile.
  onClick?: () => void;
  hint?: string;
};

export function SummaryCard({ label, value, note, tone = "default", onClick, hint }: SummaryCardProps) {
  const body = (
    <>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-text-secondary">{label}</p>
        <p
          className={cn(
            "mt-0.5 text-xl font-semibold leading-tight tabular-nums",
            tone === "danger" && "text-status-danger-text",
            tone === "warning" && "text-status-warning-text",
            tone === "success" && "text-status-success-text",
            tone === "default" && "text-text-primary",
          )}
        >
          {value}
        </p>
        <p className="mt-0.5 truncate text-xs text-text-secondary" title={note}>
          {note}
        </p>
      </div>
    </>
  );

  const base = "flex rounded-lg border border-surface-border bg-surface p-3.5 text-left shadow-sm";
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={hint}
        className={cn(base, "w-full cursor-pointer transition hover:border-accent hover:bg-surface-muted")}
      >
        {body}
      </button>
    );
  }
  return <section className={base}>{body}</section>;
}

export function formatMoney(value: string | number) {
  return `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
