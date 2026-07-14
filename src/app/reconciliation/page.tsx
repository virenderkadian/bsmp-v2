import { ReconciliationScreen } from "@/app/reconciliation/reconciliation-screen";
import { PageHeader } from "@/components/admin/page-header";
import { SecondaryButton } from "@/components/admin/buttons";
import { getReconciliationPayload } from "@/lib/reconciliation";

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams?: Promise<{ cycleDate?: string }>;
}) {
  const params = await searchParams;
  const payload = await getReconciliationPayload({ cycleDate: params?.cycleDate });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reconciliation"
        subtitle="Vehicle-wise milk movement: given at evening dispatch, delivered across the evening and morning routes, returned at morning close, and the resulting cash sale or difference."
        actions={
          <form action="/reconciliation" className="flex flex-wrap items-center gap-3">
            <input
              name="cycleDate"
              type="date"
              defaultValue={payload.cycleDate}
              className="h-10 rounded-md border border-surface-border-strong bg-surface px-3 text-sm text-text-primary outline-none transition focus:border-accent"
            />
            <SecondaryButton type="submit" className="h-10 rounded-md px-4 text-sm font-semibold">
              Reload
            </SecondaryButton>
          </form>
        }
      />

      {payload.error ? <div className="text-sm text-rose-700">{payload.error}</div> : null}

      <ReconciliationScreen payload={payload} />
    </div>
  );
}
