"use client";

import { useSearchParams } from "next/navigation";
import { IconButton } from "@/components/admin/icon-button";
import { useLoadingBar } from "@/components/admin/loading-bar";

function addDays(dateInput: string, days: number) {
  const date = new Date(`${dateInput}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatStepperDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return `${date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })} ${date.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" })}`;
}

// The same stepper as the reconciliation page: a day back, a day forward, or click the date to
// pick one. Changing it reloads the dashboard's "Today" figures for that date; the analytics
// range and vehicle choices already in the URL are kept.
export function DashboardDateStepper({ date, todayDate }: { date: string; todayDate: string }) {
  const { navigate } = useLoadingBar();
  const searchParams = useSearchParams();

  const goTo = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === todayDate) {
      params.delete("date");
    } else {
      params.set("date", next);
    }
    const query = params.toString();
    navigate(query ? `/?${query}` : "/");
  };

  return (
    <div className="flex items-center gap-1.5">
      <IconButton
        type="button"
        title="Previous day"
        aria-label="Previous day"
        onClick={() => goTo(addDays(date, -1))}
        className="border border-surface-border-strong bg-surface text-text-primary shadow-sm hover:border-accent hover:bg-surface-muted"
      >
        ‹
      </IconButton>
      <div className="relative inline-flex h-8 min-w-[150px] items-center justify-center rounded-md border border-surface-border-strong bg-surface px-3 shadow-sm transition hover:border-accent hover:bg-surface-muted">
        <span className="pointer-events-none select-none text-sm font-semibold tabular-nums text-text-primary">
          {formatStepperDate(date)}
        </span>
        <input
          type="date"
          value={date}
          onChange={(event) => event.target.value && goTo(event.target.value)}
          onClick={(event) => event.currentTarget.showPicker?.()}
          aria-label="Pick a date"
          title="Pick a date"
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <IconButton
        type="button"
        title="Next day"
        aria-label="Next day"
        onClick={() => goTo(addDays(date, 1))}
        className="border border-surface-border-strong bg-surface text-text-primary shadow-sm hover:border-accent hover:bg-surface-muted"
      >
        ›
      </IconButton>
      {date !== todayDate ? (
        <button
          type="button"
          onClick={() => goTo(todayDate)}
          className="ml-1 h-8 rounded-md border border-surface-border-strong bg-surface px-3 text-xs font-semibold text-text-secondary transition hover:bg-surface-muted"
        >
          Today
        </button>
      ) : null}
    </div>
  );
}
