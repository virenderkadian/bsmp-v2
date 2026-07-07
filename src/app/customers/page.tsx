import { CustomerScreen } from "@/app/customers/customer-screen";
import { getMastersPayload } from "@/lib/masters";

export default async function CustomersPage() {
  const payload = await getMastersPayload();

  return <CustomerScreen customers={payload.customers} dbConnected={payload.dbConnected} />;
}
