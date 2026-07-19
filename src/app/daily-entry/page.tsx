import { DailyEntryScreen } from "@/app/daily-entry/daily-entry-screen";
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
    <div className="space-y-4">
      {payload.error ? <div className="text-sm text-rose-700">{payload.error}</div> : null}

      <DailyEntryScreen payload={payload} />
    </div>
  );
}
