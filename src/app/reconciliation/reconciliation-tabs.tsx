"use client";

import { CashReportScreen } from "@/app/reconciliation/cash-report-screen";
import { ReconciliationScreen } from "@/app/reconciliation/reconciliation-screen";
import { PrimaryButton } from "@/components/admin/buttons";
import { useLoadingBar } from "@/components/admin/loading-bar";
import { MasterTabs } from "@/components/admin/master-tabs";
import type { CashReportPayload, ReconciliationPayload } from "@/lib/reconciliation";

export type ReconciliationTab = "cycle" | "cash-report";

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
}: {
  tab: ReconciliationTab;
  reconciliation: ReconciliationPayload | null;
  cashReport: CashReportPayload | null;
}) {
  const { navigate } = useLoadingBar();

  return (
    <div className="space-y-5">
      <MasterTabs
        tabs={[
          { value: "cycle", label: "Cycle" },
          { value: "cash-report", label: "Cash report" },
        ]}
        activeValue={tab}
        onChange={(value) => navigate(value === "cycle" ? "/reconciliation" : "/reconciliation?tab=cash-report")}
        className="w-fit shrink-0"
      />

      {tab === "cycle" && reconciliation ? (
        <>
          {/* Inside the tab, not above it. The cycle date belongs to this view
              alone — sitting over the tabs it read as a page-level control. */}
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              // Client-side, so the loading bar survives the wait. A native
              // form post unloads the document and takes every React component
              // with it.
              event.preventDefault();
              const value = new FormData(event.currentTarget).get("cycleDate");
              navigate(`/reconciliation?cycleDate=${String(value ?? "")}`);
            }}
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-secondary">Cycle date</span>
              <input
                name="cycleDate"
                type="date"
                defaultValue={reconciliation.cycleDate}
                className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
              />
            </label>
            <PrimaryButton type="submit" className="h-10 rounded-md px-5 text-sm font-semibold">
              Load cycle
            </PrimaryButton>
          </form>

          {reconciliation.error ? (
            <div className="text-sm text-rose-700">{reconciliation.error}</div>
          ) : null}
          <ReconciliationScreen payload={reconciliation} />
        </>
      ) : null}

      {tab === "cash-report" && cashReport ? <CashReportScreen payload={cashReport} /> : null}
    </div>
  );
}
