import Link from "next/link";
import { DataTable } from "@/components/admin/data-table";
import { PageHeader } from "@/components/admin/page-header";
import { PlusIcon } from "@/components/admin/icons";
import { StatusBadge } from "@/components/admin/status-badge";
import { cn } from "@/lib/utils";
import { getAssignmentsPayload } from "@/lib/assignments";
import { getMastersPayload } from "@/lib/masters";

function SummaryCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note: string;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-900">{value}</p>
      <p className="mt-2 text-sm text-slate-500">{note}</p>
    </section>
  );
}

export default async function Home() {
  const [masters, assignments] = await Promise.all([
    getMastersPayload(),
    getAssignmentsPayload(),
  ]);

  const activeRoutes = masters.routes.filter((route) => route.isActive).length;
  const activeCustomers = masters.customers.filter((customer) => customer.isActive).length;
  const activeProducts = masters.products.filter((product) => product.isActive).length;
  const assignedCustomers = assignments.assignments.filter(
    (assignment) => assignment.status === "ACTIVE",
  ).length;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Operational overview for dairy distribution, route setup, and billing readiness."
        actions={
          <>
            <Link
              href="/routes"
              className={cn(
                "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-600 bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700",
              )}
            >
              <PlusIcon className="h-4 w-4" />
              Manage routes
            </Link>
            <Link
              href="/daily-entry"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Open daily entry
            </Link>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Active Routes"
          value={activeRoutes}
          note="Configured for morning and evening distribution."
        />
        <SummaryCard
          label="Customers"
          value={activeCustomers}
          note="Ready for assignments, payments, and monthly bills."
        />
        <SummaryCard
          label="Products"
          value={activeProducts}
          note="Rate cards loaded into the operational master setup."
        />
        <SummaryCard
          label="Assigned Stops"
          value={assignedCustomers}
          note="Customers already linked to route sequence packets."
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Route readiness</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Routes and assignment packets available for daily dispatch.
                </p>
              </div>
              <StatusBadge tone={assignments.dbConnected ? "success" : "warning"}>
                {assignments.dbConnected ? "Live sync" : "Fallback mode"}
              </StatusBadge>
            </div>
            <div className="mt-4">
              <DataTable
                columns={["Route", "Shift", "Vehicle", "Assignments"]}
                rows={masters.routes.map((route) => ({
                  key: route.id,
                  cells: [
                    <div key="route">
                      <div className="font-medium text-slate-900">{route.name}</div>
                      <div className="text-xs text-slate-500">{route.code}</div>
                    </div>,
                    route.shift === "MORNING" ? "Morning" : "Evening",
                    route.vehicleName ?? "Unassigned",
                    assignments.assignments.filter(
                      (assignment) => assignment.routeId === route.id,
                    ).length,
                  ],
                }))}
              />
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Build order</h2>
          <p className="mt-1 text-sm text-slate-500">
            Keep the delivery workflow stable before deeper financial automation.
          </p>
          <div className="mt-5 space-y-3">
            {[
              "Finalize route and customer assignments",
              "Prefill daily entry from assignment defaults",
              "Capture payment collection against customers",
              "Generate monthly bills from saved delivery snapshots",
              "Close reconciliation with operational totals",
            ].map((item, index) => (
              <div
                key={item}
                className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
              >
                <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <p className="text-sm text-slate-600">{item}</p>
              </div>
            ))}
          </div>
        </section>
      </section>
    </>
  );
}
