import { DailyEntryScreen } from "@/app/daily-entry/daily-entry-screen";
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
      />

      {payload.error ? <div className="text-sm text-rose-700">{payload.error}</div> : null}

      <DailyEntryScreen payload={payload} />
    </div>
  );
}
