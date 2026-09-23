import { PageLoadingState } from "@/components/admin/loading-spinner";

export default function CustomersLoading() {
  return <PageLoadingState label="Loading customers" columns={4} />;
}
