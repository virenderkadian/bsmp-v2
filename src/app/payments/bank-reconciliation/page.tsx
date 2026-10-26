import { BankReconciliationScreen } from "@/app/payments/bank-reconciliation/bank-reconciliation-screen";
import { getBankReconciliationPayload } from "@/lib/bank-reconciliation";

export default async function BankReconciliationPage() {
  const payload = await getBankReconciliationPayload();
  return <BankReconciliationScreen payload={payload} />;
}
