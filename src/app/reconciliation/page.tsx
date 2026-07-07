import { SecondaryButton } from "@/components/admin/buttons";
import { DataTable } from "@/components/admin/data-table";
import { FilterBar } from "@/components/admin/filter-bar";
import { FormInput } from "@/components/admin/form-input";
import { PageHeader } from "@/components/admin/page-header";
import { SelectInput } from "@/components/admin/select-input";
import { StatusBadge } from "@/components/admin/status-badge";
import { getReconciliationPayload } from "@/lib/reconciliation";

export default async function ReconciliationPage() {
  const payload = await getReconciliationPayload();

  return (
    <>
      <PageHeader
        title="Reconciliation"
        subtitle="Operational closing view for vehicle loads, route delivery totals, and collection cross-checks."
        actions={<SecondaryButton>Export summary</SecondaryButton>}
      />

      <FilterBar>
        <FormInput label="Date" name="date" type="date" />
        <SelectInput
          label="Route"
          defaultValue=""
          placeholder="All routes"
          options={payload.routes.map((route) => ({
            value: route.id,
            label: `${route.code} - ${route.name}`,
          }))}
        />
        <SelectInput
          label="Vehicle"
          defaultValue=""
          placeholder="All vehicles"
          options={payload.vehicles.map((vehicle) => ({
            value: vehicle.id,
            label: `${vehicle.code} - ${vehicle.name}`,
          }))}
        />
        <SelectInput
          label="Status"
          defaultValue=""
          placeholder="All statuses"
          options={[
            { value: "OPEN", label: "Open" },
            { value: "MATCHED", label: "Matched" },
          ]}
        />
      </FilterBar>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Reconciliation register
            <span className="ml-2 font-normal text-slate-500">{payload.rows.length} rows</span>
          </h2>
          <StatusBadge tone={payload.dbConnected ? "success" : "warning"}>
            {payload.dbConnected ? "Live data" : "Fallback"}
          </StatusBadge>
        </div>
        <DataTable
          columns={["Date", "Route", "Vehicle", "Stops", "Qty", "Delivery", "Collected", "Status"]}
          rows={payload.rows.map((row) => ({
            key: row.key,
            cells: [
              new Date(row.entryDate).toLocaleDateString("en-IN"),
              <div key="route" className="truncate">
                <span className="font-medium text-slate-900">{row.routeName}</span>
                <span className="ml-1.5 text-sm text-slate-400">{row.routeCode}</span>
              </div>,
              row.vehicleName ?? "Unassigned",
              row.customerStops,
              `${row.totalQuantity} units`,
              `Rs ${row.deliveryAmount}`,
              `Rs ${row.verifiedCollection}`,
              <StatusBadge key="status" tone={row.status === "MATCHED" ? "success" : "warning"}>
                {row.status}
              </StatusBadge>,
            ],
          }))}
          emptyMessage="No reconciliation data yet"
          className="rounded-md border-slate-200 shadow-none"
          headClassName="bg-slate-100/70"
          headerCellClassName="px-4 py-2.5"
          rowClassName="align-middle hover:bg-slate-50/60"
          cellClassName="px-4 py-2.5"
        />
      </section>
    </>
  );
}
