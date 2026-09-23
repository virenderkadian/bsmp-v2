import { CustomerScreen } from "@/app/customers/customer-screen";
import { getCustomersPayload } from "@/lib/masters";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; routeId?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const payload = await getCustomersPayload({
    search: params.search,
    routeId: params.routeId,
    status: params.status,
    page: params.page ? Number(params.page) : 1,
  });

  return <CustomerScreen payload={payload} />;
}
