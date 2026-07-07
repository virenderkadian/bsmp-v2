import { BulkPaymentEntryScreen } from "@/app/payments/bulk-entry/bulk-payment-entry-screen";
import { getBulkPaymentPayload } from "@/lib/payments";

export default async function BulkPaymentEntryPage({
  searchParams,
}: {
  searchParams?: Promise<{ routeId?: string; month?: string; paymentDate?: string }>;
}) {
  const params = await searchParams;
  const payload = await getBulkPaymentPayload({
    routeId: params?.routeId,
    month: params?.month,
    paymentDate: params?.paymentDate,
  });

  return <BulkPaymentEntryScreen payload={payload} />;
}
