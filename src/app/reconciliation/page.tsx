import { ReconciliationTabs, type ReconciliationTab } from "@/app/reconciliation/reconciliation-tabs";
import { getReconciliationPayload, getVehicleCashReportPayload } from "@/lib/reconciliation";

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams?: Promise<{
    tab?: string;
    cycleDate?: string;
    vehicleId?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const params = await searchParams;
  const tab: ReconciliationTab = params?.tab === "cash-report" ? "cash-report" : "cycle";

  // Only the active tab's data is fetched. The cash report scans a month of
  // deliveries, and the cycle screen — the one used every day — should not wait
  // for a query it never renders.
  const reconciliation = tab === "cycle" ? await getReconciliationPayload({ cycleDate: params?.cycleDate }) : null;
  const cashReport =
    tab === "cash-report"
      ? await getVehicleCashReportPayload({
          vehicleId: params?.vehicleId,
          from: params?.from,
          to: params?.to,
        })
      : null;

  return (
    <div className="space-y-5">
      <ReconciliationTabs tab={tab} reconciliation={reconciliation} cashReport={cashReport} />
    </div>
  );
}
