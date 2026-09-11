import { cn } from "@/lib/utils";

// A sketch of each bill layout, at A4 proportions.
//
// This replaces a forty-word description that nobody was going to read. The
// shape of the page is the whole point of the choice — where the calendar sits,
// how many columns it has, how much room is left for the payment details — and
// a drawing carries that in a glance.
//
// Deliberately abstract: grey bars, not legible text. It is a diagram of the
// layout, not a preview of anyone's actual bill.

function Bar({ className }: { className?: string }) {
  return <div className={cn("rounded-[1px] bg-text-secondary/25", className)} />;
}

function Grid({ cols, rows }: { cols: number; rows: number }) {
  return (
    <div className="flex flex-col gap-[1px]">
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex gap-[1px]">
          {Array.from({ length: cols }).map((__, col) => (
            <div
              key={col}
              className={cn(
                "h-[2px] flex-1 rounded-[0.5px]",
                row === 0 ? "bg-text-secondary/40" : "bg-text-secondary/15",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function BillFormatThumbnail({ format }: { format: string }) {
  const compact = format === "compact";

  return (
    <div
      aria-hidden
      className="flex aspect-[210/297] w-[70px] shrink-0 flex-col gap-[3px] rounded-sm border border-surface-border bg-surface p-[5px] shadow-sm"
    >
      {/* Letterhead: one line on classic, a proper block on compact. */}
      <div className="flex items-start justify-between gap-1">
        <Bar className={cn("h-[3px]", compact ? "w-7" : "w-5")} />
        <Bar className="h-[2px] w-3" />
      </div>
      {compact ? (
        <>
          <Bar className="h-[1.5px] w-full" />
          {/* Customer band */}
          <div className="flex gap-[2px]">
            <Bar className="h-[7px] flex-1" />
            <Bar className="h-[7px] flex-1" />
          </div>
        </>
      ) : null}

      {compact ? (
        <div className="flex gap-[2px]">
          <div className="flex-1">
            <Grid cols={5} rows={9} />
          </div>
          <div className="flex-1">
            <Grid cols={5} rows={9} />
          </div>
        </div>
      ) : (
        <Grid cols={9} rows={18} />
      )}

      {/* Totals block, right-aligned on both. */}
      <div className="flex justify-end">
        <Bar className="h-[5px] w-6" />
      </div>

      {/* The payment footer is the visible difference: a line on classic, a
          boxed block with a QR on compact. */}
      {compact ? (
        <div className="mt-auto flex items-center gap-[3px] rounded-[1px] border border-text-secondary/35 p-[3px]">
          <div className="h-4 w-4 shrink-0 rounded-[0.5px] bg-text-secondary/45" />
          <div className="flex flex-1 flex-col gap-[1.5px]">
            <Bar className="h-[1.5px] w-full" />
            <Bar className="h-[1.5px] w-4/5" />
            <Bar className="h-[1.5px] w-3/5" />
          </div>
        </div>
      ) : (
        <div className="mt-auto flex items-center gap-[3px]">
          <div className="h-2 w-2 shrink-0 rounded-[0.5px] bg-text-secondary/30" />
          <Bar className="h-[1.5px] flex-1" />
        </div>
      )}
    </div>
  );
}
