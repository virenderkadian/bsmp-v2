import { PaymentScreen } from "@/app/payments/payment-screen";
import { getPaymentsPayload } from "@/lib/payments";

export default async function PaymentsPage() {
  const payload = await getPaymentsPayload();

  return <PaymentScreen payload={payload} />;
}
