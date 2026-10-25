"use client";

import { useRef } from "react";
import { CashReportScreen } from "@/app/reconciliation/cash-report-screen";
import { ReconciliationScreen } from "@/app/reconciliation/reconciliation-screen";
import { IconButton } from "@/components/admin/icon-button";
import { WhatsAppIcon } from "@/components/admin/icons";
import { useLoadingBar } from "@/components/admin/loading-bar";
import { MasterTabs } from "@/components/admin/master-tabs";
import type { CashReportPayload, ReconciliationPayload } from "@/lib/reconciliation";
import { buildWhatsAppShareUrl, buildWholeDayShareMessage } from "@/lib/reconciliation-share";

export type ReconciliationTab = "cycle" | "cash-report";

function addDays(dateInput: string, days: number) {
  const date = new Date(`${dateInput}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatStepperDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return `${date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} ${date.toLocaleDateString("en-IN", { weekday: "short" })}`;
}

// Two views of the same data: the cycle is where stock is entered, the cash
// report is the range read-out over it.
//
// The tab is a URL parameter rather than local state, because each view needs
// a different query — a cycle date on one side, a vehicle and range on the
// other. Loading both on every visit would make the entry screen pay for a
// month-wide scan it never shows.
export function ReconciliationTabs({
  tab,
  reconciliation,
  cashReport,
  shareTemplate,
}: {
  tab: ReconciliationTab;
  reconciliation: ReconciliationPayload | null;
  cashReport: CashReportPayload | null;
  shareTemplate: string;
}) {
  const { navigate } = useLoadingBar();
  const dateInputRef = useRef<HTMLInputElement>(null);

  const goToCycleDate = (cycleDate: string) => navigate(`/reconciliation?cycleDate=${cycleDate}`);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MasterTabs
          tabs={[
            { value: "cycle", label: "Cycle" },
            { value: "cash-report", label: "Cash report" },
          ]}
          activeValue={tab}
          onChange={(value) => navigate(value === "cycle" ? "/reconciliation" : "/reconciliation?tab=cash-report")}
          className="w-fit shrink-0"
        />

        {/* The cycle date lives beside the tabs, in the space that was
            otherwise empty — steps a day at a time and loads on change, no
            separate submit. Clicking the date itself opens a real date
            picker, for jumping more than a day or two. */}
        {tab === "cycle" && reconciliation ? (
          <div className="flex items-center gap-1.5">
            <IconButton
              type="button"
              title="Previous day"
              aria-label="Previous day"
              onClick={() => goToCycleDate(addDays(reconciliation.cycleDate, -1))}
              className="border border-surface-border-strong bg-surface text-text-primary shadow-sm hover:border-accent hover:bg-surface-muted"
            >
              ‹
            </IconButton>
            <div className="relative inline-flex h-8 min-w-[150px] items-center justify-center rounded-md border border-surface-border-strong bg-surface px-3 shadow-sm transition hover:border-accent hover:bg-surface-muted">
              <span className="pointer-events-none select-none text-sm font-semibold tabular-nums text-text-primary">
                {formatStepperDate(reconciliation.cycleDate)}
              </span>
              <input
                ref={dateInputRef}
                type="date"
                value={reconciliation.cycleDate}
                onChange={(event) => event.target.value && goToCycleDate(event.target.value)}
                onClick={(event) => event.currentTarget.showPicker?.()}
                aria-label="Pick a cycle date"
                title="Pick a cycle date"
                className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
              />
            </div>
            <IconButton
              type="button"
              title="Next day"
              aria-label="Next day"
              onClick={() => goToCycleDate(addDays(reconciliation.cycleDate, 1))}
              className="border border-surface-border-strong bg-surface text-text-primary shadow-sm hover:border-accent hover:bg-surface-muted"
            >
              ›
            </IconButton>
            {reconciliation.cycles.length > 0 ? (
              <a
                href={buildWhatsAppShareUrl(buildWholeDayShareMessage(reconciliation.cycles, shareTemplate))}
                target="_blank"
                rel="noopener noreferrer"
                title="Share the whole day on WhatsApp"
                aria-label="Share the whole day on WhatsApp"
                className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#25d366] text-[#06351a] transition hover:brightness-95"
              >
                <WhatsAppIcon className="h-4 w-4" />
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      {tab === "cycle" && reconciliation ? (
        <>
          {reconciliation.error ? (
            <div className="text-sm text-rose-700">{reconciliation.error}</div>
          ) : null}
          <ReconciliationScreen payload={reconciliation} shareTemplate={shareTemplate} />
        </>
      ) : null}

      {tab === "cash-report" && cashReport ? <CashReportScreen payload={cashReport} /> : null}
    </div>
  );
}
