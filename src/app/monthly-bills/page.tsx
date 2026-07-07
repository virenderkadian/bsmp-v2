import { MonthlyBillScreen } from "@/app/monthly-bills/monthly-bill-screen";
import { getMonthlyBillsPayload, getMonthlyBillSummary } from "@/lib/monthly-bills";

export default async function MonthlyBillsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; routeId?: string }>;
}) {
  const params = await searchParams;
  const [payload, summaryPayload] = await Promise.all([
    getMonthlyBillsPayload(),
    getMonthlyBillSummary({ month: params.month, routeId: params.routeId }),
  ]);

  return <MonthlyBillScreen payload={payload} summaryPayload={summaryPayload} />;
}
