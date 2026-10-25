import { notFound } from "next/navigation";
import { MonthlyDeliveriesScreen } from "@/app/customers/[id]/monthly-deliveries/monthly-deliveries-screen";
import { getCustomerMonthEntries } from "@/lib/customer-month-entries";

function currentMonth() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function MonthlyDeliveriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ month?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const month = sp?.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : currentMonth();

  const payload = await getCustomerMonthEntries(id, month);

  if (payload.dbConnected && !payload.customer) {
    notFound();
  }

  return <MonthlyDeliveriesScreen payload={payload} />;
}
