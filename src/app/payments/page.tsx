import { PaymentScreen } from "@/app/payments/payment-screen";
import { getPaymentsPayload } from "@/lib/payments";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    routeId?: string;
    mode?: string;
    status?: string;
    date?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const payload = await getPaymentsPayload({
    search: params.search,
    routeId: params.routeId,
    mode: params.mode,
    status: params.status,
    date: params.date,
    page: params.page ? Number(params.page) : 1,
  });

  return <PaymentScreen payload={payload} />;
}
