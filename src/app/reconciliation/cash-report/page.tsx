import { CashReportScreen } from "@/app/reconciliation/cash-report/cash-report-screen";
import { getVehicleCashReportPayload } from "@/lib/reconciliation";

export default async function CashReportPage({
  searchParams,
}: {
  searchParams?: Promise<{ vehicleId?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const payload = await getVehicleCashReportPayload({
    vehicleId: params?.vehicleId,
    from: params?.from,
    to: params?.to,
  });

  return <CashReportScreen payload={payload} />;
}
