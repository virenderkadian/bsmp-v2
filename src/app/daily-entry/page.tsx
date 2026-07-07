import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { DailyEntryForm } from "@/app/daily-entry/daily-entry-form";
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
          <form action="/daily-entry" className="flex flex-wrap items-center gap-3">
            <input
              name="entryDate"
              type="date"
              defaultValue={payload.selectedDate}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-600"
            />
            <select
              name="routeId"
              defaultValue={payload.selectedRouteId}
              className="h-10 min-w-72 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-600"
            >
              {payload.routes.length === 0 ? (
                <option value="">Select route</option>
              ) : (
                payload.routes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.name}
                  </option>
                ))
              )}
            </select>
            <SecondaryButton type="submit" className="h-10 rounded-md px-4 text-sm font-semibold">
              Reload
            </SecondaryButton>
            <PrimaryButton
              type="submit"
              form="daily-entry-form"
              disabled={payload.lines.length === 0}
              className="h-10 rounded-md px-5 text-sm font-semibold"
            >
              Save All
            </PrimaryButton>
          </form>
        }
      />

      {payload.error ? <div className="text-sm text-rose-700">{payload.error}</div> : null}

      <DailyEntryForm payload={payload} />
    </div>
  );
}
