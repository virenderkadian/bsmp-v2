import { PageLoadingState } from "@/components/admin/loading-spinner";

export default function PaymentsLoading() {
  return <PageLoadingState label="Loading payments" columns={5} />;
}
