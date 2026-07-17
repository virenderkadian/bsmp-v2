import { PrimaryButton } from "@/components/admin/buttons";
import { DailyEntryForm } from "@/app/daily-entry/daily-entry-form";
import { DailyEntryToolbar } from "@/app/daily-entry/daily-entry-toolbar";
import { PageHeader } from "@/components/admin/page-header";
import { getDailyEntryPayload } from "@/lib/daily-entry";

export default async function DailyEntryPage({
  searchParams,
}: {
  searchParams?: Promise<{ routeId?: string; entryDate?: string }>;
}) {
  const params = await searchParams;
  const payload = await getDailyEntryPayload({
    routeId: params?.routeId,
    entryDate: params?.entryDate,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Daily Entry"
        subtitle="Record daily deliveries using the selected route/month customer sequence."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <DailyEntryToolbar
              selectedDate={payload.selectedDate}
              selectedRouteId={payload.selectedRouteId}
              routes={payload.routes}
            />
            <PrimaryButton
              type="submit"
              form="daily-entry-form"
              disabled={payload.lines.length === 0}
              className="h-10 rounded-md px-5 text-sm font-semibold"
            >
              Save All
            </PrimaryButton>
          </div>
        }
      />

      {payload.error ? <div className="text-sm text-rose-700">{payload.error}</div> : null}

      <DailyEntryForm payload={payload} />
    </div>
  );
}
