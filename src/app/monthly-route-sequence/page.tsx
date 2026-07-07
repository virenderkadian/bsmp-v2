import { MonthlyRouteSequenceScreen } from "@/app/monthly-route-sequence/monthly-route-sequence-screen";
import { getMonthlyRouteSequencePayload } from "@/lib/monthly-route-sequence";

export default async function MonthlyRouteSequencePage({
  searchParams,
}: {
  searchParams?: Promise<{ routeId?: string; month?: string }>;
}) {
  const params = await searchParams;
  const payload = await getMonthlyRouteSequencePayload({
    routeId: params?.routeId,
    month: params?.month,
  });

  return <MonthlyRouteSequenceScreen payload={payload} />;
}
