import { CustomerMapScreen } from "@/app/customers/map/customer-map-screen";
import { getCustomerMapPayload } from "@/lib/customer-map";

export default async function CustomerMapPage({
  searchParams,
}: {
  searchParams: Promise<{ routeId?: string; month?: string }>;
}) {
  const params = await searchParams;
  const payload = await getCustomerMapPayload({ routeId: params.routeId, month: params.month });

  return <CustomerMapScreen payload={payload} />;
}
